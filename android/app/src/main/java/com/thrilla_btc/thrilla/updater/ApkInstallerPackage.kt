package com.thrilla_btc.thrilla.updater

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers ApkInstallerModule. Added by hand in MainApplication, since
 * autolinking only covers modules that arrive as npm packages.
 */
class ApkInstallerPackage : ReactPackage {

  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(ApkInstallerModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
