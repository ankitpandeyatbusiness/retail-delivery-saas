package expo.modules.ringermode

import android.content.Context
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Tells JavaScript how the phone's ringer is set: "normal", "vibrate" or "silent".
// (The audio library only reacts when the switch is CHANGED while a sound plays; it does not stop a new sound from starting on a phone that is already silent.)
class RingerModeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RingerMode")

    Function("getMode") {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      when (audio?.ringerMode) {
        AudioManager.RINGER_MODE_SILENT -> "silent"
        AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
        else -> "normal"
      }
    }
  }
}
