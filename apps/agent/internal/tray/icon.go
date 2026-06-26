package tray

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
)

// generateIcon creates a 32x32 tray icon PNG at runtime.
// Blue-purple gradient circle with a "G" letter on a transparent background.
func generateIcon() []byte {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	// Fill transparent background
	draw.Draw(img, img.Bounds(), image.Transparent, image.Point{}, draw.Src)

	cx, cy := size/2, size/2
	radius := size/2 - 2

	// Draw filled circle with gradient effect
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := x-cx, y-cy
			dist2 := dx*dx + dy*dy
			if dist2 <= radius*radius {
				// Gradient: top-left → blue, bottom-right → purple
				t := float64(x+y) / float64(size*2)
				r := uint8(60 + int(140*t))
				g := uint8(80 + int(60*t))
				b := uint8(200 - int(40*t))
				img.Set(x, y, color.RGBA{r, g, b, 255})
			}
		}
	}

	// Draw "G" letter in white (simple pixel art)
	drawG(img, cx, cy)

	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

// drawG draws a stylized "G" letter centered at (cx, cy).
// Uses a simple 7x9 pixel grid.
func drawG(img *image.RGBA, cx, cy int) {
	white := color.RGBA{255, 255, 255, 255}
	// G pattern (7 wide x 9 tall), centered
	pattern := []string{
		"  XXX  ",
		" X   X ",
		"X     X",
		"X      ",
		"X  XXX ",
		"X    X ",
		"X    X ",
		" X   X ",
		"  XXX  ",
	}

	startX := cx - 3
	startY := cy - 4

	for row, line := range pattern {
		for col, ch := range line {
			if ch == 'X' {
				img.Set(startX+col, startY+row, white)
			}
		}
	}
}
