package tray

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

// generateIcon creates a 32x32 tray icon PNG at runtime.
// Dark blue-purple gradient circle with a white "G" letter, opaque background.
func generateIcon() []byte {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	cx, cy := size/2, size/2
	radius := size/2 - 1

	bgColor := color.RGBA{40, 44, 52, 255} // dark gray background

	// Draw circle on solid background
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := x-cx, y-cy
			dist2 := dx*dx + dy*dy
			if dist2 <= radius*radius {
				// Gradient inside circle: blue → purple
				t := float64(x+y) / float64(size*2)
				r := uint8(60 + int(160*t))
				g := uint8(70 + int(80*t))
				b := uint8(210 - int(60*t))
				img.Set(x, y, color.RGBA{r, g, b, 255})
			} else {
				img.Set(x, y, bgColor)
			}
		}
	}

	// Draw bold white "G"
	drawG(img, cx, cy)

	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

func drawG(img *image.RGBA, cx, cy int) {
	white := color.RGBA{255, 255, 255, 255}

	// Bold "G" pattern — 11 wide x 13 tall
	pattern := []string{
		"   XXXXXXX  ",
		"  XX     XX ",
		" XX       XX",
		" XX         ",
		" XX         ",
		" XX   XXXXX ",
		" XX      XX ",
		" XX      XX ",
		" XX       XX",
		"  XX     XX ",
		"   XX   XX  ",
		"    XXXXXX  ",
		"         XX ",
	}

	startX := cx - 5
	startY := cy - 6

	for row, line := range pattern {
		for col, ch := range line {
			if ch == 'X' {
				img.Set(startX+col, startY+row, white)
			}
		}
	}
}
