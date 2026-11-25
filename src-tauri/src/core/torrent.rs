//! Minimal bencode reader for computing BitTorrent info-hashes from
//! `.torrent` payloads (needed to detect duplicates in the aria2 session).

use sha1::{Digest, Sha1};

/// Computes the v1 info-hash (SHA-1 of the bencoded `info` dict).
pub fn info_hash(torrent: &[u8]) -> Option<[u8; 20]> {
    if torrent.first() != Some(&b'd') {
        return None;
    }
    // Walk the top-level dict pairs, find the raw span of the "info" value.
    let mut i = 1;
    while i < torrent.len() {
        if torrent.get(i) == Some(&b'e') {
            return None; // dict ended without an info key
        }
        // key: <len>:<bytes>
        let colon = find(torrent, i, b':')?;
        let key_len = std::str::from_utf8(&torrent[i..colon])
            .ok()?
            .parse::<usize>()
            .ok()?;
        let key_start = colon + 1;
        let key = torrent.get(key_start..key_start + key_len)?;
        let value_start = key_start + key_len;
        let (next, _len, _v) = parse_value(torrent, value_start, 0)?;
        if key == b"info" {
            let raw = torrent.get(value_start..next)?;
            let mut hasher = Sha1::new();
            hasher.update(raw);
            let out = hasher.finalize();
            let mut hash = [0u8; 20];
            hash.copy_from_slice(&out);
            return Some(hash);
        }
        i = next;
    }
    None
}

#[derive(Debug, PartialEq)]
enum Value {
    Str,
    Int,
    List,
    Dict,
}

/// Parses one bencode value starting at `start`; returns (next_offset, byte_len, kind).
const MAX_BENCODE_DEPTH: usize = 64;

fn parse_value(buf: &[u8], start: usize, depth: usize) -> Option<(usize, usize, Value)> {
    if depth > MAX_BENCODE_DEPTH {
        return None;
    }
    let kind = *buf.get(start)?;
    match kind {
        b'i' => {
            let end = find(buf, start, b'e')?;
            Some((end + 1, end + 1 - start, Value::Int))
        }
        b'l' => parse_container(buf, start, Value::List, depth),
        b'd' => parse_container(buf, start, Value::Dict, depth),
        c if c.is_ascii_digit() => {
            let colon = find(buf, start, b':')?;
            let len = std::str::from_utf8(&buf[start..colon])
                .ok()?
                .parse::<usize>()
                .ok()?;
            let end = colon + 1 + len;
            if end > buf.len() {
                return None;
            }
            Some((end, end - start, Value::Str))
        }
        _ => None,
    }
}

/// Parses `l…e` / `d…e` containers (dict values are key:value pairs).
fn parse_container(
    buf: &[u8],
    start: usize,
    kind: Value,
    depth: usize,
) -> Option<(usize, usize, Value)> {
    let mut i = start + 1;
    loop {
        let c = *buf.get(i)?;
        if c == b'e' {
            return Some((i + 1, i + 1 - start, kind));
        }
        let (_next, _len, _v) = parse_value(buf, i, depth + 1)?;
        i = _next;
        if kind == Value::Dict {
            let (_next2, _l2, _v2) = parse_value(buf, i, depth + 1)?;
            i = _next2;
        }
    }
}

fn find(buf: &[u8], from: usize, needle: u8) -> Option<usize> {
    buf[from..]
        .iter()
        .position(|b| *b == needle)
        .map(|p| p + from)
}

/// Magnet `xt=urn:btih:<40 hex>` → lowercase hex hash.
pub fn magnet_info_hash(magnet: &str) -> Option<String> {
    let lower = magnet.to_lowercase();
    let start = lower.find("xt=urn:btih:")? + "xt=urn:btih:".len();
    let rest = &lower[start..];
    let end = rest
        .find(|c: char| c == '&' || c.is_whitespace())
        .unwrap_or(rest.len());
    let hash = &rest[..end];
    if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hash.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_hash_of_simple_torrent() {
        // d4:infod4:name4:test6:lengthi1eee
        // info dict raw span = "d4:name4:test6:lengthi1ee"
        let mut sha = Sha1::new();
        sha.update(b"d4:name4:test6:lengthi1ee");
        let expected = sha.finalize();

        let torrent = b"d4:infod4:name4:test6:lengthi1eee";
        let got = info_hash(torrent).expect("hash");
        assert_eq!(&got, expected.as_slice());
    }

    #[test]
    fn info_hash_with_nested_lists() {
        // info dict = d5:filesl6:lengthi5ee6:name4:abbae
        // (key "files" is 5 letters; the info dict's own closing 'e' is part
        // of the raw span that gets hashed)
        let mut sha = Sha1::new();
        sha.update(b"d5:filesl6:lengthi5ee4:name4:abbae");
        let expected = sha.finalize();

        let mut torrent = b"d4:info".to_vec();
        torrent.extend_from_slice(b"d5:filesl6:lengthi5ee4:name4:abbae");
        torrent.push(b'e'); // closes the top-level dict
        let got = info_hash(&torrent).expect("hash");
        assert_eq!(&got, expected.as_slice());
    }

    #[test]
    fn magnet_hash_extracted() {
        assert_eq!(
            magnet_info_hash("magnet:?xt=urn:btih:AB636CE08C829DEB3B10745EEC88800F9B687662&dn=x"),
            Some("ab636ce08c829deb3b10745eec88800f9b687662".to_string())
        );
        assert_eq!(magnet_info_hash("magnet:?dn=nohash"), None);
    }

    #[test]
    fn rejects_excessively_deep_bencode() {
        let mut torrent = b"d4:info".to_vec();
        torrent.extend(std::iter::repeat_n(b'l', MAX_BENCODE_DEPTH + 2));
        torrent.extend(std::iter::repeat_n(b'e', MAX_BENCODE_DEPTH + 2));
        torrent.push(b'e');
        assert!(info_hash(&torrent).is_none());
    }

    #[test]
    fn rejects_garbage() {
        assert!(info_hash(b"not a torrent").is_none());
        assert!(info_hash(b"").is_none());
    }
}
