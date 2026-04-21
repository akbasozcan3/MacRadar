package com.macradar

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.macradar.gallery.GalleryPickerPackage
import com.macradar.voice.VoiceRecorderPackage
import com.rnmapbox.rnmbx.v11compat.resourceoption.setMapboxAccessToken

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(GalleryPickerPackage())
          add(VoiceRecorderPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.MAPBOX_ACCESS_TOKEN.isNotBlank()) {
      setMapboxAccessToken(applicationContext, BuildConfig.MAPBOX_ACCESS_TOKEN)
    }
    loadReactNative(this)
  }
}
