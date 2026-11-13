# Narration timing

Narration is generated locally with Kokoro Say, Apache-2.0 Kokoro-82M, voice
`am_michael` at a measured, slightly slower delivery (speed 0.92). The closing
name uses the established pronunciation cue **JAH-nee**.

- 00:00–00:03 — “Mortal flesh. Jinn blood.”
- 00:03–00:06 — “Air.”
- 00:06–00:09 — “Earth.”
- 00:09–00:12 — “Fire.”
- 00:12–00:15 — “Water.”
- 00:15–00:21 — “Age cannot claim them. Death can.”
- 00:21–00:25 — “Some return. Every return has a price.”
- 00:25–00:30 — “JAH-nee: A Mortal Kind of Immortality. From Tobacco Road Games.”

The narration WAV clips are placed on separate tracks in `index.html`. The
Desert City music bed is ducked by approximately 7 dB during each spoken cue,
then smoothly restored during pauses. Across the Ghuul and hourglass sections,
the existing quieter bed level (about 4 dB below the normal level) remains in
place between cues. The music fade remains 28.5–30 seconds. There is no
narration ducking beyond this explicit volume automation.
