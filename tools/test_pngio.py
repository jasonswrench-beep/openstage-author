# SPDX-License-Identifier: Apache-2.0
"""Tests for the small PNG reader and writer used to make character packs."""
import pathlib
import struct
import sys
import unittest
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pngio as p  # noqa: E402


def solid(w, h, rgba):
    return bytearray(bytes(rgba) * (w * h))


def png_with(colour, rows, w, h, depth=8, interlace=0, palette=b"", trans=b""):
    """A PNG built by hand from already filtered rows (each row: filter byte then bytes), so every filter can be tried."""
    raw = b"".join(rows)
    out = p.SIGNATURE + p._chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, colour, 0, 0, interlace))
    if palette:
        out += p._chunk(b"PLTE", palette)
    if trans:
        out += p._chunk(b"tRNS", trans)
    return out + p._chunk(b"IDAT", zlib.compress(raw)) + p._chunk(b"IEND", b"")


class Roundtrip(unittest.TestCase):
    def test_a_picture_written_is_the_picture_read(self):
        px = bytearray()
        for y in range(5):
            for x in range(7):
                px += bytes((x * 30, y * 40, (x + y) * 10, 255 - x * 20))
        w, h, back = p.read_png(p.write_png(7, 5, px))
        self.assertEqual((w, h), (7, 5))
        self.assertEqual(bytes(back), bytes(px))

    def test_the_size_can_be_read_without_the_points(self):
        data = p.write_png(3, 2, solid(3, 2, (1, 2, 3, 4)))
        self.assertEqual(p.size_of(data), (3, 2))
        with self.assertRaises(p.PngError):
            p.size_of(b"not a picture")

    def test_every_row_filter_is_undone(self):
        # Row 0 is the plain row [10,20,30,255] [40,50,60,255]; the next rows are the same row, filtered each way against the one above.
        base = [10, 20, 30, 255, 40, 50, 60, 255]
        above = base
        target = [15, 25, 35, 255, 70, 80, 90, 255]
        none = bytes([0] + target)
        sub = bytes([1] + [target[i] if i < 4 else (target[i] - target[i - 4]) & 255 for i in range(8)])
        up = bytes([2] + [(target[i] - above[i]) & 255 for i in range(8)])
        avg = bytes([3] + [(target[i] - (((target[i - 4] if i >= 4 else 0) + above[i]) >> 1)) & 255 for i in range(8)])
        paeth = bytes([4] + [(target[i] - p._paeth(target[i - 4] if i >= 4 else 0, above[i], above[i - 4] if i >= 4 else 0)) & 255 for i in range(8)])
        for name, filtered in (("none", none), ("sub", sub), ("up", up), ("average", avg), ("paeth", paeth)):
            data = png_with(6, [bytes([0] + base), filtered], 2, 2)
            w, h, px = p.read_png(data)
            self.assertEqual(list(px[8:]), target, name)

    def test_greys_colours_and_palettes_come_out_as_rgba(self):
        self.assertEqual(list(p.read_png(png_with(2, [bytes([0, 1, 2, 3])], 1, 1))[2]), [1, 2, 3, 255])
        self.assertEqual(list(p.read_png(png_with(0, [bytes([0, 9])], 1, 1))[2]), [9, 9, 9, 255])
        self.assertEqual(list(p.read_png(png_with(4, [bytes([0, 9, 100])], 1, 1))[2]), [9, 9, 9, 100])
        data = png_with(3, [bytes([0, 1, 0])], 2, 1, palette=bytes([10, 20, 30, 40, 50, 60]), trans=bytes([255, 128]))
        self.assertEqual(list(p.read_png(data)[2]), [40, 50, 60, 128, 10, 20, 30, 255])

    def test_what_cannot_be_read_is_refused_with_words(self):
        for data, word in (
            (b"GIF89a", "not a PNG"),
            (png_with(6, [bytes([0] + [0] * 8)], 2, 1, depth=16), "eight bits"),
            (png_with(6, [bytes([0] + [0] * 4)], 1, 1, interlace=1), "interlaced"),
            (png_with(6, [bytes([0] + [0] * 4)], 1, 1)[:-20], "cut short"),
        ):
            with self.assertRaises(p.PngError) as ctx:
                p.read_png(data)
            self.assertIn(word, str(ctx.exception))

    def test_a_picture_that_asks_for_too_much_memory_is_refused(self):
        data = p.SIGNATURE + p._chunk(b"IHDR", struct.pack(">IIBBBBB", 30000, 30000, 8, 6, 0, 0, 0)) + p._chunk(b"IEND", b"")
        with self.assertRaises(p.PngError):
            p.read_png(data)


class Shapes(unittest.TestCase):
    def test_the_box_round_a_figure_ignores_clear_points(self):
        px = solid(10, 8, (0, 0, 0, 0))
        for y in range(2, 6):
            for x in range(3, 7):
                px[(y * 10 + x) * 4:(y * 10 + x) * 4 + 4] = bytes((9, 9, 9, 255))
        self.assertEqual(p.content_box(10, 8, px), (3, 2, 7, 6))
        self.assertIsNone(p.content_box(10, 8, solid(10, 8, (0, 0, 0, 0))))

    def test_a_very_faint_point_is_not_part_of_the_figure(self):
        px = solid(4, 4, (0, 0, 0, 3))
        self.assertIsNone(p.content_box(4, 4, px))

    def test_a_crop_keeps_the_points_and_makes_clear_ones_where_it_reaches_outside(self):
        px = bytearray()
        for y in range(4):
            for x in range(4):
                px += bytes((x, y, 0, 255))
        w, h, c = p.crop(4, 4, px, (1, 1, 3, 3))
        self.assertEqual((w, h), (2, 2))
        self.assertEqual(list(c[:4]), [1, 1, 0, 255])
        w, h, c = p.crop(4, 4, px, (-1, -1, 1, 1))
        self.assertEqual(list(c[:4]), [0, 0, 0, 0])
        self.assertEqual(list(c[-4:]), [0, 0, 0, 255])
        with self.assertRaises(ValueError):
            p.crop(4, 4, px, (2, 2, 2, 3))


class Shrinking(unittest.TestCase):
    def test_a_solid_colour_stays_that_colour(self):
        out = p.resize(10, 10, solid(10, 10, (200, 100, 50, 255)), 3, 7)
        for i in range(0, len(out), 4):
            self.assertEqual(list(out[i:i + 4]), [200, 100, 50, 255])

    def test_two_by_two_becomes_one_by_averaging(self):
        px = bytearray(bytes((0, 0, 0, 255)) + bytes((100, 100, 100, 255)) + bytes((100, 100, 100, 255)) + bytes((200, 200, 200, 255)))
        self.assertEqual(list(p.resize(2, 2, px, 1, 1)), [100, 100, 100, 255])

    def test_a_clear_edge_does_not_darken_the_colour(self):
        # Left half solid red, right half clear black: the one point that results is half solid and still red.
        px = bytearray(bytes((255, 0, 0, 255)) + bytes((0, 0, 0, 0)))
        self.assertEqual(list(p.resize(2, 1, px, 1, 1)), [255, 0, 0, 128])

    def test_the_size_asked_for_is_the_size_made_even_when_it_does_not_divide(self):
        out = p.resize(7, 5, solid(7, 5, (1, 2, 3, 255)), 4, 3)
        self.assertEqual(len(out), 4 * 3 * 4)

    def test_a_picture_is_never_made_larger(self):
        with self.assertRaises(ValueError):
            p.resize(2, 2, solid(2, 2, (0, 0, 0, 255)), 4, 4)


if __name__ == "__main__":
    unittest.main()
