package org.mare.music;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@UnstableApi
@RunWith(AndroidJUnit4.class)
public class BackgroundPlaybackTest {
  private File wave(Context context, String name, int seconds) throws Exception {
    File file = new File(context.getCacheDir(), name);
    int size = 8000 * seconds * 2;
    ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
    header
        .put("RIFF".getBytes())
        .putInt(size + 36)
        .put("WAVEfmt ".getBytes())
        .putInt(16)
        .putShort((short) 1)
        .putShort((short) 1)
        .putInt(8000)
        .putInt(16000)
        .putShort((short) 2)
        .putShort((short) 16)
        .put("data".getBytes())
        .putInt(size);
    try (FileOutputStream out = new FileOutputStream(file)) {
      out.write(header.array());
      out.write(new byte[size]);
    }
    return file;
  }

  @Test
  public void nativeQueueContinuesAfterHomeAndScreenOff() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    Context context = instrumentation.getTargetContext();
    instrumentation.startActivitySync(
        new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    File first = wave(context, "first.wav", 2), second = wave(context, "second.wav", 20);
    AtomicReference<ExoPlayer> actual = new AtomicReference<>();
    instrumentation.runOnMainSync(
        () -> context.startService(new Intent(context, PlaybackService.class)));
    SystemClock.sleep(300);
    instrumentation.runOnMainSync(
        () -> {
          try {
            Field instance = PlaybackService.class.getDeclaredField("instance");
            instance.setAccessible(true);
            Field field = PlaybackService.class.getDeclaredField("player");
            field.setAccessible(true);
            ExoPlayer player = (ExoPlayer) field.get(instance.get(null));
            actual.set(player);
            player.setMediaItems(
                List.of(
                    new MediaItem.Builder().setMediaId("first").setUri(Uri.fromFile(first)).build(),
                    new MediaItem.Builder()
                        .setMediaId("second")
                        .setUri(Uri.fromFile(second))
                        .build()));
            player.prepare();
            player.play();
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
    SystemClock.sleep(700);
    instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME").close();
    instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_SLEEP").close();
    SystemClock.sleep(5000);
    try {
      instrumentation.runOnMainSync(
          () -> {
            assertEquals("second", actual.get().getCurrentMediaItem().mediaId);
            assertTrue(
                "audio must continue in the foreground media service", actual.get().isPlaying());
            assertTrue(actual.get().getCurrentPosition() > 1000);
            actual.get().pause();
          });
    } finally {
      instrumentation
          .getUiAutomation()
          .executeShellCommand("input keyevent KEYCODE_WAKEUP")
          .close();
      context.stopService(new Intent(context, PlaybackService.class));
      first.delete();
      second.delete();
    }
  }
}
