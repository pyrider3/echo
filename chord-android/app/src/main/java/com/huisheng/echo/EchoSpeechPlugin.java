package com.huisheng.echo;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(name = "EchoSpeech", permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }))
public class EchoSpeechPlugin extends Plugin implements RecognitionListener {
    private SpeechRecognizer recognizer;
    private PluginCall pending;

    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "permissionResult"); return;
        }
        begin(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("需要麦克风权限");
    }

    private void begin(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.destroy();
            pending = call;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(this);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "zh-CN"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recognizer.startListening(intent);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; } });
        if (pending != null) { pending.reject("cancelled"); pending = null; }
        call.resolve();
    }

    public void onResults(Bundle data) { finish(data); }
    private void finish(Bundle data) {
        ArrayList<String> values = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (pending != null) { JSObject out = new JSObject(); out.put("text", values == null || values.isEmpty() ? "" : values.get(0)); pending.resolve(out); pending = null; }
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
    }
    public void onError(int error) { if (pending != null) { pending.reject("没有听清"); pending = null; } if (recognizer != null) { recognizer.destroy(); recognizer = null; } }
    public void onReadyForSpeech(Bundle b) {} public void onBeginningOfSpeech() {} public void onRmsChanged(float v) {}
    public void onBufferReceived(byte[] b) {} public void onEndOfSpeech() {} public void onPartialResults(Bundle b) {} public void onEvent(int t, Bundle b) {}
}
