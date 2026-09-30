package com.huisheng.echo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineZipformer2CtcModelConfig
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** Local two-pass Chinese ASR: streaming Zipformer preview + SenseVoice final pass. */
class SherpaTwoPassEngine(private val context: Context) {
    interface Listener {
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onError(message: String)
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val STREAMING_DIR = "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01"
        private const val SENSE_DIR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09"
    }

    @Volatile var ready = false
        private set
    @Volatile var loading = false
        private set
    @Volatile var error: String? = null
        private set
    @Volatile private var recording = false

    private var online: OnlineRecognizer? = null
    private var offline: OfflineRecognizer? = null
    private var recorder: AudioRecord? = null
    private var worker: Thread? = null
    private var listener: Listener? = null
    private var autoFinish = false
    private val chunks = CopyOnWriteArrayList<FloatArray>()

    fun prepare(onComplete: (() -> Unit)? = null) {
        if (ready || loading) return
        loading = true
        thread(name = "echo-sherpa-init") {
            try {
                val feat = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80)
                online = OnlineRecognizer(
                    assetManager = context.assets,
                    config = OnlineRecognizerConfig(
                        featConfig = feat,
                        modelConfig = OnlineModelConfig(
                            zipformer2Ctc = OnlineZipformer2CtcModelConfig(
                                model = "$STREAMING_DIR/model.int8.onnx"
                            ),
                            tokens = "$STREAMING_DIR/tokens.txt",
                            numThreads = 2,
                            modelType = "zipformer2"
                        ),
                        enableEndpoint = true
                    )
                )
                offline = OfflineRecognizer(
                    assetManager = context.assets,
                    config = OfflineRecognizerConfig(
                        featConfig = feat,
                        modelConfig = OfflineModelConfig(
                            senseVoice = OfflineSenseVoiceModelConfig(
                                model = "$SENSE_DIR/model.int8.onnx",
                                language = "zh",
                                useInverseTextNormalization = true
                            ),
                            tokens = "$SENSE_DIR/tokens.txt",
                            numThreads = 4,
                            modelType = "sense_voice"
                        ),
                        ruleFsts = "itn_zh_number.fst"
                    )
                )
                ready = true
                error = null
            } catch (t: Throwable) {
                error = t.message ?: t.javaClass.simpleName
                release()
            } finally {
                loading = false
                onComplete?.invoke()
            }
        }
    }

    fun start(listener: Listener, autoFinish: Boolean = false): Boolean {
        if (!ready || recording) return false
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 6400))
        if (audio.state != AudioRecord.STATE_INITIALIZED) {
            audio.release()
            return false
        }
        this.listener = listener
        this.autoFinish = autoFinish
        chunks.clear()
        recorder = audio
        recording = true
        audio.startRecording()
        worker = thread(name = "echo-sherpa-stream") { streamLoop(audio) }
        return true
    }

    private fun streamLoop(audio: AudioRecord) {
        val recognizer = online ?: return
        val stream = recognizer.createStream()
        val pcm = ShortArray(1600)
        var committed = ""
        try {
            while (recording) {
                val count = audio.read(pcm, 0, pcm.size)
                if (count <= 0) continue
                val samples = FloatArray(count) { pcm[it] / 32768.0f }
                chunks.add(samples)
                stream.acceptWaveform(samples, SAMPLE_RATE)
                while (recognizer.isReady(stream)) recognizer.decode(stream)
                val current = recognizer.getResult(stream).text.trim()
                val preview = (committed + current).replace(" ", "")
                if (preview.isNotEmpty()) listener?.onPartial(preview)
                if (recognizer.isEndpoint(stream)) {
                    committed += current
                    recognizer.reset(stream)
                    if (autoFinish && committed.isNotBlank()) {
                        thread(name = "echo-sherpa-auto-finish") { finish() }
                        break
                    }
                }
            }
        } catch (t: Throwable) {
            if (recording) listener?.onError("实时识别失败")
        } finally {
            stream.release()
        }
    }

    fun finish() {
        if (!recording) return
        recording = false
        try { recorder?.stop() } catch (_: Throwable) {}
        try { worker?.join(1200) } catch (_: InterruptedException) {}
        recorder?.release()
        recorder = null
        worker = null
        val captured = chunks.toList()
        thread(name = "echo-sherpa-final") { runFinalPass(captured) }
    }

    private fun runFinalPass(captured: List<FloatArray>) {
        try {
            val size = captured.sumOf { it.size }
            if (size < SAMPLE_RATE / 5) throw IllegalStateException("没有听清")
            val samples = FloatArray(size)
            var offset = 0
            captured.forEach { part -> part.copyInto(samples, offset); offset += part.size }
            val recognizer = offline ?: throw IllegalStateException("高精度识别尚未就绪")
            val stream = recognizer.createStream()
            stream.acceptWaveform(samples, SAMPLE_RATE)
            recognizer.decode(stream)
            val text = recognizer.getResult(stream).text.replace(" ", "").trim()
            stream.release()
            if (text.isBlank()) listener?.onError("没有听清") else listener?.onFinal(text)
        } catch (t: Throwable) {
            listener?.onError(t.message ?: "高精度识别失败")
        }
    }

    fun cancel() {
        recording = false
        try { recorder?.stop() } catch (_: Throwable) {}
        recorder?.release()
        recorder = null
        chunks.clear()
    }

    fun release() {
        cancel()
        online?.release()
        offline?.release()
        online = null
        offline = null
        ready = false
    }
}
