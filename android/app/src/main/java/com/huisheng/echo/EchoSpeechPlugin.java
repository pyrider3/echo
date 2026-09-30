package com.huisheng.echo;

import android.Manifest;
import android.content.Intent;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.media.MediaRecorder;
import android.media.AudioManager;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;
import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "EchoSpeech", permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }))
public class EchoSpeechPlugin extends Plugin implements android.speech.RecognitionListener, org.vosk.android.RecognitionListener {
    private SpeechRecognizer systemRecognizer;
    private SpeechService offlineSpeechService;
    private Model offlineModel;
    private boolean offlineModelLoading;
    private String offlineModelError;
    private PluginCall pending;
    private String latestOfflineText = "";
    private SherpaTwoPassEngine twoPass;
    private boolean usingTwoPass;
    private TextToSpeech tts;
    private PluginCall ttsPending;
    private MediaRecorder sampleRecorder;
    private File sampleRecordingFile;
    private long sampleRecordingStartedAt;

    @Override
    public void load() {
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        twoPass = new SherpaTwoPassEngine(getContext());
        twoPass.prepare(null);
    }

    private synchronized void prepareOfflineModel() {
        if (offlineModel != null || offlineModelLoading) return;
        offlineModelLoading = true;
        offlineModelError = null;
        StorageService.unpack(getContext(), "model-cn", "echo-speech-model",
            model -> { offlineModel = model; offlineModelLoading = false; },
            exception -> { offlineModelError = exception.getMessage(); offlineModelLoading = false; });
    }

    @PluginMethod
    public void recognitionStatus(PluginCall call) {
        JSObject status = new JSObject();
        boolean highReady = twoPass != null && twoPass.getReady();
        status.put("ready", highReady || offlineModel != null);
        status.put("loading", twoPass != null && twoPass.getLoading());
        status.put("engine", highReady ? "sherpa-two-pass" : (offlineModel != null ? "vosk-offline" : "android-on-device"));
        status.put("error", twoPass != null && twoPass.getError() != null ? twoPass.getError() : (offlineModelError == null ? "" : offlineModelError));
        call.resolve(status);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "permissionResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("需要麦克风权限");
    }

    @PluginMethod
    public void startVoiceSampleRecording(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "recordingPermissionResult");
            return;
        }
        beginVoiceSampleRecording(call);
    }

    @PermissionCallback
    private void recordingPermissionResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginVoiceSampleRecording(call);
        else call.reject("需要麦克风权限才能录制音色");
    }

    private void beginVoiceSampleRecording(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                cancelVoiceSampleInternal();
                stopRecognition(false);
                sampleRecordingFile = new File(getContext().getCacheDir(), "echo-voice-" + System.currentTimeMillis() + ".m4a");
                sampleRecorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? new MediaRecorder(getContext()) : new MediaRecorder();
                sampleRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                sampleRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                sampleRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                sampleRecorder.setAudioSamplingRate(44100);
                sampleRecorder.setAudioEncodingBitRate(128000);
                sampleRecorder.setOutputFile(sampleRecordingFile.getAbsolutePath());
                sampleRecorder.prepare();
                sampleRecorder.start();
                sampleRecordingStartedAt = System.currentTimeMillis();
                JSObject result = new JSObject();
                result.put("recording", true);
                call.resolve(result);
            } catch (Exception exception) {
                cancelVoiceSampleInternal();
                call.reject("无法开始录音，请检查麦克风权限");
            }
        });
    }

    @PluginMethod
    public void voiceSampleRecordingStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("recording", sampleRecorder != null);
        result.put("duration", sampleRecorder == null ? 0 : System.currentTimeMillis() - sampleRecordingStartedAt);
        int amplitude = 0;
        try { if (sampleRecorder != null) amplitude = sampleRecorder.getMaxAmplitude(); } catch (Exception ignored) {}
        result.put("amplitude", amplitude);
        call.resolve(result);
    }

    @PluginMethod
    public void stopVoiceSampleRecording(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (sampleRecorder == null || sampleRecordingFile == null) { call.reject("当前没有正在录制的音频"); return; }
            long duration = System.currentTimeMillis() - sampleRecordingStartedAt;
            try {
                sampleRecorder.stop();
                sampleRecorder.release();
                sampleRecorder = null;
                byte[] bytes = readFile(sampleRecordingFile);
                JSObject result = new JSObject();
                result.put("audio", Base64.encodeToString(bytes, Base64.NO_WRAP));
                result.put("mime", "audio/mp4");
                result.put("name", sampleRecordingFile.getName());
                result.put("duration", duration);
                call.resolve(result);
            } catch (Exception exception) {
                call.reject(duration < 1000 ? "录音时间太短" : "录音保存失败，请重试");
            } finally {
                if (sampleRecorder != null) { try { sampleRecorder.release(); } catch (Exception ignored) {} sampleRecorder = null; }
                if (sampleRecordingFile != null) sampleRecordingFile.delete();
                sampleRecordingFile = null;
                sampleRecordingStartedAt = 0;
            }
        });
    }

    @PluginMethod
    public void cancelVoiceSampleRecording(PluginCall call) {
        getActivity().runOnUiThread(this::cancelVoiceSampleInternal);
        call.resolve();
    }

    private byte[] readFile(File file) throws IOException {
        byte[] data = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int count = input.read(data, offset, data.length - offset);
                if (count < 0) break;
                offset += count;
            }
        }
        return data;
    }

    private void cancelVoiceSampleInternal() {
        if (sampleRecorder != null) {
            try { sampleRecorder.stop(); } catch (Exception ignored) {}
            try { sampleRecorder.release(); } catch (Exception ignored) {}
            sampleRecorder = null;
        }
        if (sampleRecordingFile != null) { sampleRecordingFile.delete(); sampleRecordingFile = null; }
        sampleRecordingStartedAt = 0;
    }

    private void begin(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopRecognition(false);
            pending = call;
            latestOfflineText = "";
            usingTwoPass = false;
            if (twoPass != null && twoPass.getReady()) startTwoPassRecognition(call.getBoolean("autoFinish", false));
            else if (twoPass != null && twoPass.getLoading()) waitForTwoPass(0);
            else if (offlineModel != null) startOfflineRecognition();
            else if (offlineModelLoading) waitForOfflineModel(0);
            else {
                prepareOfflineModel();
                if (offlineModelError == null) waitForOfflineModel(0);
                else startSystemRecognition();
            }
        });
    }

    private void waitForTwoPass(int attempt) {
        if (pending == null) return;
        if (twoPass != null && twoPass.getReady()) { startTwoPassRecognition(pending != null && pending.getBoolean("autoFinish", false)); return; }
        if (twoPass == null || !twoPass.getLoading() || attempt >= 120) {
            if (offlineModel != null) startOfflineRecognition(); else waitForOfflineModel(0);
            return;
        }
        getActivity().getWindow().getDecorView().postDelayed(() -> waitForTwoPass(attempt + 1), 100);
    }

    private void startTwoPassRecognition(boolean autoFinish) {
        usingTwoPass = twoPass.start(new SherpaTwoPassEngine.Listener() {
            @Override public void onPartial(String text) {
                JSObject data = new JSObject();
                data.put("text", text);
                notifyListeners("partialResult", data);
            }
            @Override public void onFinal(String text) { resolvePending(text, "sherpa-two-pass"); }
            @Override public void onError(String message) { rejectPending(message); }
        }, autoFinish);
        if (!usingTwoPass) {
            if (offlineModel != null) startOfflineRecognition(); else startSystemRecognition();
        }
    }

    private void waitForOfflineModel(int attempt) {
        if (pending == null) return;
        if (offlineModel != null) { startOfflineRecognition(); return; }
        if (!offlineModelLoading || attempt >= 80) { startSystemRecognition(); return; }
        getActivity().getWindow().getDecorView().postDelayed(() -> waitForOfflineModel(attempt + 1), 100);
    }

    private void startOfflineRecognition() {
        try {
            Recognizer recognizer = new Recognizer(offlineModel, 16000.0f);
            offlineSpeechService = new SpeechService(recognizer, 16000.0f);
            offlineSpeechService.startListening(this);
        } catch (IOException exception) {
            offlineModelError = exception.getMessage();
            startSystemRecognition();
        }
    }

    private void startSystemRecognition() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()))
                systemRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            else systemRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            systemRecognizer.setRecognitionListener(this);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            systemRecognizer.startListening(intent);
        } catch (Exception exception) {
            rejectPending("本地语音识别暂不可用");
        }
    }

    @PluginMethod
    public void finishListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (usingTwoPass && twoPass != null) twoPass.finish();
            else if (offlineSpeechService != null) offlineSpeechService.stop();
            if (systemRecognizer != null) systemRecognizer.stopListening();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> stopRecognition(true));
        call.resolve();
    }

    private void stopRecognition(boolean reject) {
        if (twoPass != null && usingTwoPass) twoPass.cancel();
        usingTwoPass = false;
        if (offlineSpeechService != null) {
            offlineSpeechService.stop();
            offlineSpeechService.shutdown();
            offlineSpeechService = null;
        }
        if (systemRecognizer != null) {
            systemRecognizer.cancel();
            systemRecognizer.destroy();
            systemRecognizer = null;
        }
        if (reject && pending != null) rejectPending("cancelled");
    }

    private String readText(String hypothesis) {
        try {
            JSONObject json = new JSONObject(hypothesis == null ? "{}" : hypothesis);
            String text = json.optString("text", "").trim();
            return text.isEmpty() ? json.optString("partial", "").trim() : text;
        } catch (Exception ignored) { return ""; }
    }

    private void resolvePending(String text, String engine) {
        if (pending == null) return;
        String normalized = text == null ? "" : text.replace(" ", "").trim();
        if (normalized.isEmpty()) { rejectPending("没有听清"); return; }
        JSObject result = new JSObject();
        result.put("text", normalized);
        result.put("engine", engine);
        pending.resolve(result);
        pending = null;
        stopRecognition(false);
    }

    private void rejectPending(String message) {
        if (pending != null) { pending.reject(message); pending = null; }
        stopRecognition(false);
    }

    @Override public void onPartialResult(String hypothesis) { String text = readText(hypothesis); if (!text.isEmpty()) latestOfflineText = text; }
    @Override public void onResult(String hypothesis) { String text = readText(hypothesis); if (!text.isEmpty()) latestOfflineText = text; }
    @Override public void onFinalResult(String hypothesis) { String text = readText(hypothesis); resolvePending(text.isEmpty() ? latestOfflineText : text, "vosk-offline"); }
    @Override public void onTimeout() { resolvePending(latestOfflineText, "vosk-offline"); }
    @Override public void onError(Exception exception) { rejectPending("本地识别失败，请重试"); }

    @Override public void onResults(Bundle data) {
        ArrayList<String> values = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        resolvePending(values == null || values.isEmpty() ? "" : values.get(0), "android-on-device");
    }
    @Override public void onError(int error) { rejectPending("没有听清"); }
    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onPartialResults(Bundle partialResults) {}
    @Override public void onEvent(int eventType, Bundle params) {}

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> ensureTts(call, text));
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (tts != null) tts.stop();
            if (ttsPending != null) { ttsPending.reject("cancelled"); ttsPending = null; }
            call.resolve();
        });
    }

    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        boolean speaker = call.getBoolean("speaker", true);
        getActivity().runOnUiThread(() -> {
            AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (audio == null) { call.reject("无法切换音频输出"); return; }
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(speaker);
            call.resolve();
        });
    }

    @PluginMethod
    public void resetAudioRoute(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                audio.setSpeakerphoneOn(false);
                audio.setMode(AudioManager.MODE_NORMAL);
            }
            call.resolve();
        });
    }

    private void ensureTts(PluginCall call, String text) {
        if (tts != null) { startTts(call, text); return; }
        tts = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS) { call.reject("系统语音初始化失败"); tts = null; return; }
            tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
            tts.setSpeechRate(1.03f);
            tts.setPitch(1.0f);
            startTts(call, text);
        });
    }

    private void startTts(PluginCall call, String text) {
        if (ttsPending != null) ttsPending.reject("cancelled");
        ttsPending = call;
        String utteranceId = UUID.randomUUID().toString();
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { if (ttsPending == call) { call.resolve(); ttsPending = null; } }
            @Deprecated @Override public void onError(String id) { onError(id, TextToSpeech.ERROR); }
            @Override public void onError(String id, int errorCode) { if (ttsPending == call) { call.reject("系统语音播放失败"); ttsPending = null; } }
        });
        int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (result == TextToSpeech.ERROR) { call.reject("系统语音播放失败"); ttsPending = null; }
    }

    @Override
    protected void handleOnDestroy() {
        stopRecognition(false);
        cancelVoiceSampleInternal();
        if (twoPass != null) { twoPass.release(); twoPass = null; }
        if (offlineModel != null) { offlineModel.close(); offlineModel = null; }
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }
}
