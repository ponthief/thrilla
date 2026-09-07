package com.thrilla_btc.thrilla

import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Thrilla"

  /**
   * Keeps the wallet out of the app-switcher thumbnail.
   *
   * Android screenshots every activity as it goes to the background to draw the
   * recents preview, so the balance and any open address sat there in plain
   * view, readable by anyone holding the phone without unlocking anything. The
   * app lock used to hide this by accident, by locking on every trip to the
   * background — now that it locks on a delay instead, the window is real, and
   * a lock policy was never the right instrument for it anyway.
   *
   * FLAG_SECURE makes the system draw a blank instead. It is set once here
   * rather than toggled around sensitive screens: the flag applies to the whole
   * window, and anything that turns it off and on again leaves exactly the gap
   * it was added to close.
   *
   * The cost, which is real: this also blocks screenshots and screen recording
   * across the app, and screen mirroring shows blank. Sharing a receive address
   * still works — that path shares text through the OS share sheet rather than
   * an image — but a user cannot photograph their own QR from inside the app.
   * That is the accepted trade for the thumbnail; if screenshots matter more,
   * this is the one line to remove.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    window.setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE,
    )
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
