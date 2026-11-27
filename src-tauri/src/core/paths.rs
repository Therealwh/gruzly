//! Display helpers for paths that cross into the UI or the clipboard.

use std::path::Path;

/// Windows verbatim paths (`\\?\C:\…`) work for the OS but break when pasted
/// into a browser's folder picker or shown to the user. Convert them back to
/// the plain form; leave every other path alone.
pub fn normalize_path_string(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.to_string()
    }
}

/// Path as it should appear in the UI, the clipboard or a toast.
pub fn display_path(path: &Path) -> String {
    normalize_path_string(&path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_verbatim_prefix() {
        assert_eq!(
            normalize_path_string(r"\\?\C:\Users\LZT\AppData\Local\Gruzly\extension"),
            r"C:\Users\LZT\AppData\Local\Gruzly\extension"
        );
        assert_eq!(
            normalize_path_string(r"\\?\UNC\server\share\folder"),
            r"\\server\share\folder"
        );
    }

    #[test]
    fn keeps_plain_and_unicode_paths() {
        assert_eq!(normalize_path_string(r"C:\Downloads"), r"C:\Downloads");
        assert_eq!(
            normalize_path_string("/home/лзт/Загрузки"),
            "/home/лзт/Загрузки"
        );
        assert_eq!(normalize_path_string(""), "");
    }
}
