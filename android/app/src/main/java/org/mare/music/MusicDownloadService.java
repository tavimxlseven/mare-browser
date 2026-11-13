package org.mare.music;

import android.app.Notification;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.*;
import androidx.media3.exoplayer.scheduler.Scheduler;
import java.util.List;

@UnstableApi
public final class MusicDownloadService extends DownloadService {
  private DownloadNotificationHelper notifications;

  public MusicDownloadService() {
    super(2, 1000, "mare-downloads", 0, 0);
  }

  @Override
  public void onCreate() {
    android.app.NotificationManager manager =
        getSystemService(android.app.NotificationManager.class);
    manager.createNotificationChannel(
        new android.app.NotificationChannel(
            "mare-downloads",
            "Downloads de música",
            android.app.NotificationManager.IMPORTANCE_LOW));
    notifications = new DownloadNotificationHelper(this, "mare-downloads");
    super.onCreate();
  }

  @Override
  protected DownloadManager getDownloadManager() {
    return AudioStore.manager(this);
  }

  @Override
  protected Scheduler getScheduler() {
    return null;
  }

  @Override
  protected Notification getForegroundNotification(
      List<Download> downloads, int notMetRequirements) {
    return notifications.buildProgressNotification(
        this,
        R.drawable.ic_music,
        null,
        "Salvando músicas no aparelho",
        downloads,
        notMetRequirements);
  }
}
