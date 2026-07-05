import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AUDIO_DATA_SPEC,
  AUDIO_EXPORT_KIND,
  AUDIO_EXPORT_VERSION,
  audioTitleFromName,
  audioTrackFromExport,
  audioTrackToExport,
  createAudioLibraryExport,
  isSupportedAudioFile,
  normalizeAudioPlaybackState,
  parseAudioLibraryExport,
  type AudioTrack,
} from "./audio-store"
import { PLUGIN_DATA_PACKAGE_KIND, PLUGIN_DATA_PACKAGE_VERSION } from "@/plugins/shared/plugin-data"

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

test("audioTrackToExport/audioTrackFromExport: Blob 以 base64 往返", async () => {
  const track: AudioTrack = {
    id: "a1",
    title: "Tone",
    mime: "audio/wav",
    size: 3,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    createdAt: 1,
    updatedAt: 2,
  }

  const exported = await audioTrackToExport(track)
  assert.equal(exported.dataBase64, "AQID")
  const restored = audioTrackFromExport(exported)
  assert.equal(restored.id, track.id)
  assert.equal(restored.title, track.title)
  assert.equal(restored.mime, track.mime)
  assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test("parseAudioLibraryExport: 校验版本并规范化播放状态", () => {
  const raw = JSON.stringify({
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: AUDIO_DATA_SPEC.pluginId,
      label: AUDIO_DATA_SPEC.pluginLabel,
      dataKind: AUDIO_EXPORT_KIND,
      dataVersion: AUDIO_EXPORT_VERSION,
    },
    exportedAt: "2026-01-01T00:00:00.000Z",
    payload: {
      playback: {
        currentTrackId: "a1",
        currentTime: -10,
        volume: 2,
        repeat: "bad",
        shuffle: "no",
      },
      tracks: [
        {
          id: "a1",
          title: "Tone",
          mime: "audio/wav",
          size: 3,
          createdAt: 1,
          updatedAt: 2,
          dataBase64: "AQID",
        },
      ],
    },
  })

  assert.deepEqual(parseAudioLibraryExport(raw), {
    kind: PLUGIN_DATA_PACKAGE_KIND,
    version: PLUGIN_DATA_PACKAGE_VERSION,
    plugin: {
      id: AUDIO_DATA_SPEC.pluginId,
      label: AUDIO_DATA_SPEC.pluginLabel,
      dataKind: AUDIO_EXPORT_KIND,
      dataVersion: AUDIO_EXPORT_VERSION,
    },
    exportedAt: "2026-01-01T00:00:00.000Z",
    payload: {
      playback: {
        currentTrackId: "a1",
        currentTime: 0,
        volume: 1,
        repeat: "none",
        shuffle: false,
      },
      tracks: [
        {
          id: "a1",
          title: "Tone",
          artist: undefined,
          album: undefined,
          mime: "audio/wav",
          size: 3,
          duration: undefined,
          createdAt: 1,
          updatedAt: 2,
          dataBase64: "AQID",
        },
      ],
    },
  })
  assert.throws(
    () => parseAudioLibraryExport(JSON.stringify({ kind: "bad", version: 1 })),
    /不支持/,
  )
})

test("createAudioLibraryExport: 固定导出封套", () => {
  assert.deepEqual(
    createAudioLibraryExport(
      [],
      { currentTrackId: null, currentTime: 0, volume: 0.5, repeat: "one", shuffle: true },
      "now",
    ),
    {
      kind: PLUGIN_DATA_PACKAGE_KIND,
      version: PLUGIN_DATA_PACKAGE_VERSION,
      plugin: {
        id: AUDIO_DATA_SPEC.pluginId,
        label: AUDIO_DATA_SPEC.pluginLabel,
        dataKind: AUDIO_EXPORT_KIND,
        dataVersion: AUDIO_EXPORT_VERSION,
      },
      exportedAt: "now",
      payload: {
        playback: {
          currentTrackId: null,
          currentTime: 0,
          volume: 0.5,
          repeat: "one",
          shuffle: true,
        },
        tracks: [],
      },
    },
  )
})
