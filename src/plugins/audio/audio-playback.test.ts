import assert from "node:assert/strict"
import test from "node:test"
import { audioFilePlaybackKey, audioLibraryPlaybackKey } from "./audio-playback"

test("audio playback keys keep library tracks and file versions isolated", () => {
  assert.equal(audioLibraryPlaybackKey("track:1"), "library:track:1")

  const ref = { fileSystemId: "local", fileId: "music/song.mp3" }
  assert.equal(audioFilePlaybackKey(ref, "7"), audioFilePlaybackKey(ref, "7"))
  assert.notEqual(audioFilePlaybackKey(ref, "7"), audioFilePlaybackKey(ref, "8"))
  assert.notEqual(audioFilePlaybackKey(ref, "7"), audioLibraryPlaybackKey("music/song.mp3"))
})
