# YT Ultrawide Fit

A browser extension for Brave, Chrome or Edge. In fullscreen on an ultrawide screen it:

- **zooms** videos whose picture has black bars baked in (cinematic 2.33–2.40:1 content inside a 16:9 file), so the picture fills the screen
- **leaves alone** normal 16:9 videos (side borders stay) and videos uploaded natively in a wide format (they already fit)

## Install (Brave)

1. Open `brave://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this `yt-ultrawide-fit` folder
4. Optional: pin the icon with the puzzle-piece menu so the popup is one click away
5. Reload any YouTube tabs that are already open

## Use

- Play a video and go fullscreen. It analyses the picture for about 2 seconds, then zooms in smoothly if the content is wide. A short message on the player shows the detected ratio and the zoom.
- **Z** cycles **Auto → Force fill → Off** for the current video. Force fill crops to fill the screen, for when detection misses.
- The popup shows what was detected (bar size, real content ratio, zoom) and has the settings.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Zoom only in fullscreen | on | Untick to also zoom in the normal and theater player |
| Zoom content wider than | 1.90 | 16:9 is 1.78, cinema is 2.39. Content narrower than this keeps its borders |
| Black level | 24 | Raise it if bars aren't detected (washed-out bars); lower it if dark scenes trigger zoom |

## How detection stays safe

Twice a second a 256 px wide copy of the frame is checked for black rows at the top and bottom.
Dark scenes can only make bars look *bigger* and logos or subtitles can only make them look *smaller*, so the extension uses the **smallest** bar seen over the last 8 readable frames.
Real picture is never cropped. Zooming in waits for confirmation, and zooming out happens on the next check.
Ads, Shorts and DRM-protected movies (frames can't be read) are left untouched.
