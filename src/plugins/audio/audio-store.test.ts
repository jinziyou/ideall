import { test } from "node:test"
import assert from "node:assert/strict"
import {
  audioTitleFromName,
  isSupportedAudioFile,
  normalizeAudioPlaybackState,
} from "./audio-store"

test("audioTitleFromName: 扩展名剥离并保留无扩展名标题", () => {
  assert.equal(audioTitleFromName("track.demo.mp3"), "track.demo")
  assert.equal(audioTitleFromName("README"), "README")
  assert.equal(audioTitleFromName(".hidden"), ".hidden")
})

test("isSupportedAudioFile: MIME 与主流音频扩展名都可识别", () => {
  assert.equal(isSupportedAudioFile({ name: "voice.bin", type: "audio/webm" }), true)
  assert.equal(isSupportedAudioFile({ name: "song.FLAC", type: "" }), true)
  assert.equal(isSupportedAudioFile({ name: "notes.txt", type: "text/plain" }), false)
})

test("normalizeAudioPlaybackState: 修正坏值并夹紧音量/时间", () => {
  assert.deepEqual(
    normalizeAudioPlaybackState({
      currentTrackId: 123,
      currentTime: -9,
      volume: 2,
      repeat: "bad",
      shuffle: "yes",
    }),
    {
      currentTrackId: null,
      currentTime: 0,
      volume: 1,
      repeat: "none",
      shuffle: false,
    },
  )

  assert.deepEqual(
    normalizeAudioPlaybackState({
      currentTrackId: "t1",
      currentTime: 12,
      volume: 0.25,
      repeat: "all",
      shuffle: true,
    }),
    {
      currentTrackId: "t1",
      currentTime: 12,
      volume: 0.25,
      repeat: "all",
      shuffle: true,
    },
  )
})
