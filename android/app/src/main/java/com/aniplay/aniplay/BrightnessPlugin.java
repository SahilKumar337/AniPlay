package com.aniplay.aniplay;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

/**
 * BrightnessPlugin — controls the device's screen brightness from JavaScript.
 *
 * Uses WindowManager.LayoutParams.screenBrightness which sets the brightness
 * for this Activity's window only (range 0.0 to 1.0, or -1.0 to restore
 * the system default). This does NOT require any special permissions.
 *
 * JS usage:
 *   const Brightness = registerPlugin('Brightness');
 *   await Brightness.setBrightness({ value: 0.75 });   // 0.0–1.0
 *   await Brightness.getBrightness();                   // returns { value: 0.75 }
 *   await Brightness.resetBrightness();                 // restore system default
 */
@CapacitorPlugin(name = "Brightness")
public class BrightnessPlugin extends Plugin {

    /** Set window brightness. value must be in [0.0, 1.0]. */
    @PluginMethod
    public void setBrightness(PluginCall call) {
        float value = call.getFloat("value", -1f);

        // Clamp to valid Android range [0.0, 1.0]; -1 means system default
        if (value < 0f) value = 0f;
        if (value > 1f) value = 1f;

        final float brightness = value;
        getActivity().runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = brightness;
                getActivity().getWindow().setAttributes(lp);
                JSObject result = new JSObject();
                result.put("value", brightness);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to set brightness: " + e.getMessage());
            }
        });
    }

    /** Get current window brightness (returns -1.0 if using system default). */
    @PluginMethod
    public void getBrightness(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                JSObject result = new JSObject();
                result.put("value", lp.screenBrightness); // -1.0 = system default
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to get brightness: " + e.getMessage());
            }
        });
    }

    /** Restore system-controlled brightness (sets screenBrightness = -1). */
    @PluginMethod
    public void resetBrightness(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE; // = -1f
                getActivity().getWindow().setAttributes(lp);
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to reset brightness: " + e.getMessage());
            }
        });
    }
}
