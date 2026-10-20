# SPDX-License-Identifier: Apache-2.0
"""Reading, cutting out, shrinking and writing PNG pictures with nothing but the standard library.

This is for the people who make character packs (tools/make_character_pack.py): it turns the pictures a picture service made into
smaller ones that are all cut to the same frame. It is not used when a course is made or played. Only the PNGs such services make are
read: eight bits to a colour, not interlaced. A picture is (width, height, pixels), the pixels being a `bytearray` of R, G, B, A for
each point, left to right, top to bottom.
"""
import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Nothing a person makes a character from needs more than this; it also stops a damaged file asking for all the memory there is.
MAX_SIDE = 8192
MAX_POINTS = 40_000_000


class PngError(ValueError):
    """The file is not a PNG this tool can read."""


def _chunks(data):
    if data[:8] != SIGNATURE:
        raise PngError("That is not a PNG picture.")
    pos = 8
    while pos + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if len(body) != length:
            raise PngError("The PNG picture is cut short.")
        yield kind, body
        pos += 12 + length


def size_of(data):
    """The width and height of a PNG, without reading its points."""
    for kind, body in _chunks(data):
        if kind == b"IHDR":
            if len(body) < 8:
                break
            return struct.unpack(">II", body[:8])
        break
    raise PngError("That is not a PNG picture.")


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _unfilter(kind, line, prev, bpp):
    """One row of a PNG back to its real values. `prev` is the row above, already unfiltered."""
    n = len(line)
    if kind == 0:
        return bytearray(line)
    out = bytearray(line)
    if kind == 1:  # left
        for i in range(bpp, n):
            out[i] = (out[i] + out[i - bpp]) & 255
    elif kind == 2:  # above
        for i in range(n):
            out[i] = (out[i] + prev[i]) & 255
    elif kind == 3:  # average of left and above
        for i in range(n):
            left = out[i - bpp] if i >= bpp else 0
            out[i] = (out[i] + ((left + prev[i]) >> 1)) & 255
    elif kind == 4:  # Paeth
        for i in range(n):
            left = out[i - bpp] if i >= bpp else 0
            upleft = prev[i - bpp] if i >= bpp else 0
            out[i] = (out[i] + _paeth(left, prev[i], upleft)) & 255
    else:
        raise PngError("The PNG picture uses a row filter that does not exist.")
    return out


def read_png(data):
    """Read a PNG into (width, height, rgba). Greys, colours, palettes and transparency are all brought to RGBA."""
    header = None
    palette = b""
    trans = b""
    idat = []
    for kind, body in _chunks(data):
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body[:13])
        elif kind == b"PLTE":
            palette = body
        elif kind == b"tRNS":
            trans = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    if header is None:
        raise PngError("That is not a PNG picture.")
    w, h, depth, colour, _compression, _filter, interlace = header
    if depth != 8:
        raise PngError("Only PNG pictures with eight bits to a colour can be read.")
    if interlace != 0:
        raise PngError("An interlaced PNG picture cannot be read. Save it again without interlacing.")
    if colour not in (0, 2, 3, 4, 6):
        raise PngError("The PNG picture has a kind of colour that does not exist.")
    if not (0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE and w * h <= MAX_POINTS):
        raise PngError("The PNG picture is too large.")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    raw = zlib.decompress(b"".join(idat))
    stride = w * channels
    if len(raw) < (stride + 1) * h:
        raise PngError("The PNG picture is cut short.")
    rows = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(h):
        row = _unfilter(raw[pos], raw[pos + 1:pos + 1 + stride], prev, channels)
        rows.append(row)
        prev = row
        pos += stride + 1
    out = bytearray(w * h * 4)
    o = 0
    for row in rows:
        if colour == 6:
            out[o:o + stride] = row
        elif colour == 2:
            for i in range(0, stride, 3):
                out[o + (i // 3) * 4:o + (i // 3) * 4 + 4] = bytes((row[i], row[i + 1], row[i + 2], 255))
        elif colour == 0:
            for i in range(w):
                g = row[i]
                out[o + i * 4:o + i * 4 + 4] = bytes((g, g, g, 255))
        elif colour == 4:
            for i in range(w):
                g = row[i * 2]
                out[o + i * 4:o + i * 4 + 4] = bytes((g, g, g, row[i * 2 + 1]))
        else:  # palette
            for i in range(w):
                k = row[i]
                r, g, b = palette[k * 3:k * 3 + 3] if k * 3 + 3 <= len(palette) else (0, 0, 0)
                out[o + i * 4:o + i * 4 + 4] = bytes((r, g, b, trans[k] if k < len(trans) else 255))
        o += w * 4
    return w, h, out


def _chunk(kind, body):
    crc = zlib.crc32(kind + body) & 0xFFFFFFFF
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)


def write_png(w, h, rgba):
    """A PNG of the picture. Each row is filtered the way that leaves the smallest numbers, which makes the file smaller."""
    stride = w * 4
    out = bytearray()
    prev = bytes(stride)
    for y in range(h):
        row = bytes(rgba[y * stride:(y + 1) * stride])
        sub = bytearray(row)
        for i in range(stride - 1, 3, -1):
            sub[i] = (row[i] - row[i - 4]) & 255
        up = bytes((a - b) & 255 for a, b in zip(row, prev))
        best, kind = row, 0
        best_cost = sum(min(v, 256 - v) for v in row)
        for k, candidate in ((1, sub), (2, up)):
            cost = sum(min(v, 256 - v) for v in candidate)
            if cost < best_cost:
                best, kind, best_cost = candidate, k, cost
        out.append(kind)
        out += best
        prev = row
    return SIGNATURE + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(bytes(out), 9)) + _chunk(b"IEND", b"")


def content_box(w, h, rgba, threshold=16):
    """The smallest box (left, top, right, bottom, the last two not included) holding every point that is at least a little solid. None if nothing is."""
    left, top, right, bottom = w, h, 0, 0
    stride = w * 4
    for y in range(h):
        alpha = rgba[y * stride + 3:(y + 1) * stride:4]
        if max(alpha) < threshold:
            continue
        first = next(i for i, a in enumerate(alpha) if a >= threshold)
        last = w - 1 - next(i for i, a in enumerate(reversed(alpha)) if a >= threshold)
        left, right = min(left, first), max(right, last + 1)
        top, bottom = min(top, y), y + 1
    return None if right <= left else (left, top, right, bottom)


def crop(w, h, rgba, box):
    """The part of a picture inside a box. Where the box reaches outside the picture the new points are clear."""
    left, top, right, bottom = box
    nw, nh = right - left, bottom - top
    if nw <= 0 or nh <= 0:
        raise ValueError("The box has nothing in it.")
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        sy = top + y
        if not 0 <= sy < h:
            continue
        x0, x1 = max(left, 0), min(right, w)
        if x1 <= x0:
            continue
        out[(y * nw + (x0 - left)) * 4:(y * nw + (x1 - left)) * 4] = rgba[(sy * w + x0) * 4:(sy * w + x1) * 4]
    return nw, nh, out


def _taps(src, dst):
    """For each of `dst` places, which of `src` places feed it and by how much (the shares add up to one). Shrinking averages the whole of each stretch."""
    scale = src / dst
    taps = []
    for d in range(dst):
        a, b = d * scale, (d + 1) * scale
        first, last = int(a), min(int(b - 1e-9), src - 1)
        share = []
        for s in range(first, last + 1):
            weight = min(b, s + 1) - max(a, s)
            if weight > 0:
                share.append((s, weight / scale))
        taps.append(share)
    return taps


def resize(w, h, rgba, nw, nh):
    """The picture at another size, made by averaging. Colours are weighted by how solid each point is, so a clear edge does not turn dark or pale."""
    if (nw, nh) == (w, h):
        return bytearray(rgba)
    if nw > w or nh > h:
        raise ValueError("Pictures are only made smaller.")
    htaps = _taps(w, nw)
    # Across: each row becomes nw points of (red*alpha, green*alpha, blue*alpha, alpha) as numbers that can be added.
    rows = []
    for y in range(h):
        base = y * w * 4
        row = [0.0] * (nw * 4)
        for x, share in enumerate(htaps):
            r = g = b = a = 0.0
            for s, weight in share:
                p = base + s * 4
                alpha = rgba[p + 3] * weight
                r += rgba[p] * alpha
                g += rgba[p + 1] * alpha
                b += rgba[p + 2] * alpha
                a += alpha
            row[x * 4:x * 4 + 4] = (r, g, b, a)
        rows.append(row)
    # Down: the same, then back to colours.
    out = bytearray(nw * nh * 4)
    for y, share in enumerate(_taps(h, nh)):
        acc = [0.0] * (nw * 4)
        for s, weight in share:
            row = rows[s]
            for i in range(nw * 4):
                acc[i] += row[i] * weight
        o = y * nw * 4
        for x in range(nw):
            r, g, b, a = acc[x * 4:x * 4 + 4]
            if a <= 0:
                continue
            out[o + x * 4] = min(255, int(r / a + 0.5))
            out[o + x * 4 + 1] = min(255, int(g / a + 0.5))
            out[o + x * 4 + 2] = min(255, int(b / a + 0.5))
            out[o + x * 4 + 3] = min(255, int(a + 0.5))
    return out
