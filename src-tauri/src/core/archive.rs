//! Archive extraction with path-traversal protection.
//!
//! Every entry path is validated before anything is written: absolute
//! paths, parent components, drive prefixes/stream separators and Windows
//! reserved names are rejected outright, while symlink and hardlink entries
//! are skipped instead of followed. All extraction targets are resolved
//! below a canonical destination directory, and extraction is additive —
//! the archive itself is never modified or removed.

use std::fs::{self, File};
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};

/// Stable error code returned when a RAR archive cannot be unpacked because
/// no system 7-Zip installation was found.
pub const RAR_UNAVAILABLE: &str = "archiveRarUnavailable";

/// Suffixes accepted by [`is_archive`]. `.rar` is included because [`extract`]
/// can drive a system 7-Zip; without one it fails with [`RAR_UNAVAILABLE`].
const ARCHIVE_SUFFIXES: [&str; 7] = [".tar.gz", ".tgz", ".zip", ".7z", ".tar", ".gz", ".rar"];

/// Windows device names that a directory entry must not use, with or
/// without an extension (`CON`, `CON.txt`, …).
const WINDOWS_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// True when `name` looks like an archive this module can unpack.
pub fn is_archive(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    ARCHIVE_SUFFIXES
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

/// Extract `archive` into `destination` (created when missing).
///
/// The format is chosen from the archive file name. Errors are plain
/// messages; [`RAR_UNAVAILABLE`] is the one stable code callers may match on.
pub fn extract(archive: &Path, destination: &Path) -> Result<(), String> {
    if !archive.is_file() {
        return Err(format!("archive not found: {}", archive.display()));
    }
    fs::create_dir_all(destination)
        .map_err(|err| format!("could not create destination folder: {err}"))?;
    let destination = destination
        .canonicalize()
        .map_err(|err| format!("could not resolve destination folder: {err}"))?;
    let file_name = archive
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "archive name is not valid UTF-8".to_string())?
        .to_ascii_lowercase();

    if file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz") {
        extract_tar_gz(archive, &destination)
    } else if file_name.ends_with(".tar") {
        extract_tar(archive, &destination)
    } else if file_name.ends_with(".zip") {
        extract_zip(archive, &destination)
    } else if file_name.ends_with(".7z") {
        extract_7z(archive, &destination)
    } else if file_name.ends_with(".gz") {
        extract_gz(archive, &destination)
    } else if file_name.ends_with(".rar") {
        extract_rar(archive, &destination)
    } else {
        Err(format!("unsupported archive format: {file_name}"))
    }
}

/// The file name produced when a `*.gz` single-file archive is unpacked
/// (`report.txt.gz` → `report.txt`).
fn archive_stem(archive: &Path) -> Result<PathBuf, String> {
    archive
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "archive has no file name".to_string())
}

/// Resolve an archive entry name into a path below `destination`, rejecting
/// anything that could escape it.
fn target_for(destination: &Path, raw: &str) -> Result<PathBuf, String> {
    let relative = clean_relative_path(raw)?;
    let target = destination.join(relative);
    if !target.starts_with(destination) {
        return Err(unsafe_entry(raw));
    }
    Ok(target)
}

fn unsafe_entry(raw: &str) -> String {
    format!("unsafe archive entry: {raw}")
}

/// Validate a raw entry name and return a relative, traversal-free path.
fn clean_relative_path(raw: &str) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err(unsafe_entry(raw));
    }
    // Archives are written by other platforms: normalize separators first.
    let normalized = raw.replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') {
        return Err(unsafe_entry(raw));
    }
    let mut relative = PathBuf::new();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(unsafe_entry(raw));
        }
        // `C:` drive prefixes, alternate data streams (`file:stream`) and
        // UNC leftovers all contain a colon and are never valid here.
        if part.contains(':') || is_reserved_windows_name(part) {
            return Err(unsafe_entry(raw));
        }
        relative.push(part);
    }
    if relative.as_os_str().is_empty() {
        return Err(unsafe_entry(raw));
    }
    Ok(relative)
}

fn is_reserved_windows_name(part: &str) -> bool {
    if part.ends_with('.') || part.ends_with(' ') {
        return true;
    }
    let stem = part
        .split('.')
        .next()
        .unwrap_or(part)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    WINDOWS_RESERVED_NAMES.contains(&stem.as_str())
}

/// ZIP entries: skip symlinks, validate every name, never follow links.
fn extract_zip(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|err| format!("could not open zip archive: {err}"))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|err| format!("invalid zip archive: {err}"))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|err| format!("invalid zip entry: {err}"))?;
        if entry.is_symlink() {
            continue;
        }
        let name = entry.name().to_string();
        let target = target_for(destination, &name)?;
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|err| format!("could not create folder {name}: {err}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("could not create folder {name}: {err}"))?;
        }
        let mut out =
            File::create(&target).map_err(|err| format!("could not write {name}: {err}"))?;
        io::copy(&mut entry, &mut out).map_err(|err| format!("could not write {name}: {err}"))?;
    }
    Ok(())
}

/// 7z entries: the crate offers a per-entry callback, so names can be checked
/// before the default writer would join them blindly.
fn extract_7z(archive: &Path, destination: &Path) -> Result<(), String> {
    sevenz_rust::decompress_file_with_extract_fn(
        archive,
        destination,
        |entry, reader, _default_target| {
            let name = entry.name();
            let target = target_for(destination, name).map_err(sevenz_rust::Error::other)?;
            if entry.is_directory() {
                fs::create_dir_all(&target).map_err(sevenz_rust::Error::io)?;
                return Ok(true);
            }
            // Unix mode bits are carried in the high word of the Windows
            // attributes field; skip links instead of materializing them.
            if is_symlink_mode(entry.windows_attributes()) {
                return Ok(true);
            }
            // Anti-items mark files deleted by a later revision of the
            // archive; they carry no content of their own.
            if entry.is_anti_item() {
                return Ok(true);
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(sevenz_rust::Error::io)?;
            }
            let mut out = File::create(&target).map_err(sevenz_rust::Error::io)?;
            io::copy(reader, &mut out).map_err(sevenz_rust::Error::io)?;
            Ok(true)
        },
    )
    .map_err(|err| format!("could not extract 7z archive: {err}"))
}

fn is_symlink_mode(attributes: u32) -> bool {
    let unix_mode = attributes >> 16;
    unix_mode & 0o170000 == 0o120000
}

fn extract_tar(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|err| format!("could not open tar archive: {err}"))?;
    extract_tar_reader(BufReader::new(file), destination)
}

fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let file =
        File::open(archive).map_err(|err| format!("could not open tar.gz archive: {err}"))?;
    let decoder = flate2::read::GzDecoder::new(BufReader::new(file));
    extract_tar_reader(decoder, destination)
}

fn extract_tar_reader<R: Read>(reader: R, destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|err| format!("invalid tar archive: {err}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|err| format!("invalid tar entry: {err}"))?;
        let kind = entry.header().entry_type();
        // Links are skipped, never materialized: following them could write
        // outside the destination.
        if kind.is_symlink() || kind.is_hard_link() {
            continue;
        }
        let name = entry
            .path()
            .map_err(|err| format!("invalid tar entry name: {err}"))?
            .to_string_lossy()
            .into_owned();
        let target = target_for(destination, &name)?;
        if kind.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|err| format!("could not create folder {name}: {err}"))?;
            continue;
        }
        // Devices, FIFOs and other special entries are not extracted.
        if !(kind.is_file() || kind.is_contiguous()) {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("could not create folder {name}: {err}"))?;
        }
        let mut out =
            File::create(&target).map_err(|err| format!("could not write {name}: {err}"))?;
        io::copy(&mut entry, &mut out).map_err(|err| format!("could not write {name}: {err}"))?;
    }
    Ok(())
}

/// Single-file `.gz`: decompress next to the other entries as `<stem>`.
fn extract_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let name = archive_stem(archive)?
        .to_str()
        .ok_or_else(|| "archive name is not valid UTF-8".to_string())?
        .to_string();
    let target = target_for(destination, &name)?;
    let file = File::open(archive).map_err(|err| format!("could not open gz archive: {err}"))?;
    let mut decoder = flate2::read::GzDecoder::new(BufReader::new(file));
    let mut out = File::create(&target).map_err(|err| format!("could not write {name}: {err}"))?;
    io::copy(&mut decoder, &mut out).map_err(|err| format!("could not write {name}: {err}"))?;
    Ok(())
}

/// RAR needs a bundled binary we do not ship; a system 7-Zip is used when
/// present, otherwise the stable [`RAR_UNAVAILABLE`] code is returned.
fn extract_rar(archive: &Path, destination: &Path) -> Result<(), String> {
    let seven_zip = find_seven_zip().ok_or_else(|| RAR_UNAVAILABLE.to_string())?;
    // 7z.exe does not understand Rust's `\\?\` verbatim paths.
    let destination = shell_path(destination);
    let mut command = std::process::Command::new(seven_zip);
    command
        .arg("-y")
        .arg(format!("-o{}", destination.display()))
        .arg(archive);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let status = command
        .status()
        .map_err(|err| format!("could not run 7-Zip: {err}"))?;
    if !status.success() {
        return Err(format!("7-Zip failed with status {status}"));
    }
    Ok(())
}

fn find_seven_zip() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(base) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(base).join("7-Zip").join("7z.exe"));
        }
    }
    for executable in ["7z.exe", "7za.exe", "7zz.exe", "7za", "7zz"] {
        if let Some(path) = find_on_path(executable) {
            candidates.push(path);
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn find_on_path(executable: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|folder| folder.join(executable))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn shell_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

#[cfg(not(windows))]
fn shell_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn recognizes_supported_archives() {
        for name in [
            "a.zip",
            "a.7z",
            "a.tar",
            "a.tar.gz",
            "a.tgz",
            "a.gz",
            "a.rar",
            "REPORT.ZIP",
            "bundle.TAR.GZ",
        ] {
            assert!(is_archive(name), "{name} should be an archive");
        }
        for name in ["a.txt", "a.zip.part", "archive", "a.tar.bz2", ""] {
            assert!(!is_archive(name), "{name} should not be an archive");
        }
    }

    #[test]
    fn rejects_traversal_and_absolute_entry_paths() {
        for raw in [
            "../evil",
            "..\\evil",
            "a/../../b",
            "/etc/passwd",
            "C:/Windows/x",
            "C:\\Windows\\x",
            "\\\\server\\share\\x",
            "//server/share/x",
            "file.txt:stream",
            "nested/CON",
            "nested/COM1.txt",
            "trailing.",
            "trailing ",
        ] {
            assert!(clean_relative_path(raw).is_err(), "{raw} must be rejected");
        }
        assert_eq!(
            clean_relative_path("nested\\ok.txt").unwrap(),
            PathBuf::from("nested/ok.txt")
        );
        assert_eq!(
            clean_relative_path("./a//b.txt").unwrap(),
            PathBuf::from("a/b.txt")
        );
    }

    #[test]
    fn extracts_zip_and_rejects_traversal_entries() {
        let root = std::env::temp_dir().join(format!("gruzly-archive-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let archive = root.join("sample.zip");
        write_zip(
            &archive,
            &[("hello.txt", b"hello"), ("nested/ok.bin", b"\x01\x02")],
        );
        let destination = root.join("out");
        extract(&archive, &destination).unwrap();
        assert_eq!(fs::read(destination.join("hello.txt")).unwrap(), b"hello");
        assert_eq!(
            fs::read(destination.join("nested/ok.bin")).unwrap(),
            b"\x01\x02".to_vec()
        );

        let evil = root.join("evil.zip");
        write_zip(&evil, &[("../evil.txt", b"boom")]);
        let evil_destination = root.join("out2");
        let error = extract(&evil, &evil_destination).unwrap_err();
        assert!(error.contains("unsafe archive entry"), "{error}");
        assert!(!root.join("evil.txt").exists());

        fs::remove_dir_all(root).unwrap();
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }
}
