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
  @Test
  public void restoresTrackQueueAndPositionWithoutAutoplay() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    Context context = instrumentation.getTargetContext();
    instrumentation.startActivitySync(
        new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    String scope = AudioStore.scope("https://music.example", "resume-fixture");
    var catalog =
        new org.json.JSONArray()
            .put(MusicApi.json("id", "resume", "title", "Resume fixture", "status", "ready"))
            .put(MusicApi.json("id", "next", "title", "Next fixture", "status", "ready"));
    context
        .getSharedPreferences("playback-" + scope, 0)
        .edit()
        .putString("catalog", catalog.toString())
        .putString(
            "state",
            MusicApi.json(
                    "id",
                    "resume",
                    "position",
                    42000,
                    "queue",
                    new org.json.JSONArray().put("next"),
                    "context",
                    new org.json.JSONArray().put("resume").put("next"),
                    "repeat",
                    "all",
                    "volume",
                    0.4)
                .toString())
        .commit();
    instrumentation.runOnMainSync(
        () ->
            context.startService(
                new Intent(context, PlaybackService.class)
                    .setAction("org.mare.music.COMMAND")
                    .putExtra(
                        "command",
                        MusicApi.json(
                                "action",
                                "configure",
                                "origin",
                                "https://music.example",
                                "account",
                                "resume-fixture",
                                "cookie",
                                "")
                            .toString())));
    SystemClock.sleep(500);
    instrumentation.runOnMainSync(
        () -> {
          org.json.JSONObject restored = PlaybackService.snapshot(context);
          assertEquals("resume", restored.optString("id"));
          assertEquals(42000, restored.optLong("position"));
          assertFalse(restored.optBoolean("playing"));
          assertEquals("next", restored.optJSONArray("queue").optString(0));
        });
    context.stopService(new Intent(context, PlaybackService.class));
  }

  @org.junit.Before
  public void wakeAndUnlock() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    instrumentation
        .getUiAutomation()
        .executeShellCommand("pm grant org.mare.music android.permission.POST_NOTIFICATIONS")
        .close();
    instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_WAKEUP").close();
    instrumentation.getUiAutomation().executeShellCommand("wm dismiss-keyguard").close();
    SystemClock.sleep(400);
  }

  @Test
  public void nativeLibraryRendersWithoutAWebView() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    Context context = instrumentation.getTargetContext();
    MusicApi api = new MusicApi(context);
    api.origin = "https://music.example";
    api.account = "ui-fixture";
    api.cookie = "fixture";
    api.persist();
    org.json.JSONArray tracks = new org.json.JSONArray();
    for (String name : new String[] {"Midnight City", "After Hours", "Nights"})
      tracks.put(
          MusicApi.json(
              "id",
              name.replace(" ", ""),
              "title",
              name,
              "artist",
              "Music fixture",
              "status",
              "ready",
              "art",
              ""));
    var playlists =
        new org.json.JSONArray()
            .put(
                MusicApi.json(
                    "id",
                    "evening",
                    "name",
                    "Evening rotation",
                    "tracks",
                    new org.json.JSONArray().put("MidnightCity").put("Nights"),
                    "art",
                    ""));
    context
        .getSharedPreferences("library-" + AudioStore.scope(api.origin, api.account), 0)
        .edit()
        .putString("cache", MusicApi.json("tracks", tracks, "playlists", playlists).toString())
        .commit();
    android.app.Activity activity =
        instrumentation.startActivitySync(
            new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    SystemClock.sleep(1000);
    instrumentation.runOnMainSync(
        () -> assertFalse(containsWebView(activity.getWindow().getDecorView())));
    if (android.os.Build.VERSION.SDK_INT >= 29) {
      android.content.ContentValues values = new android.content.ContentValues();
      values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "native-library.png");
      values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
      values.put(
          android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MareTestEvidence");
      android.net.Uri image =
          context
              .getContentResolver()
              .insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
      try (java.io.OutputStream output = context.getContentResolver().openOutputStream(image)) {
        instrumentation
            .getUiAutomation()
            .takeScreenshot()
            .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
      }
    }
    instrumentation.runOnMainSync(
        () -> {
          try {
            Field current = MainActivity.class.getDeclaredField("current");
            current.setAccessible(true);
            current.set(activity, "MidnightCity");
            Field queue = MainActivity.class.getDeclaredField("queue");
            queue.setAccessible(true);
            ((java.util.List<String>) queue.get(activity)).add("AfterHours");
            ((java.util.List<String>) queue.get(activity)).add("Nights");
            var method = MainActivity.class.getDeclaredMethod("openPlayer");
            method.setAccessible(true);
            method.invoke(activity);
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
    SystemClock.sleep(500);
    capture(context, "native-player.png");
    instrumentation.runOnMainSync(
        () -> {
          try {
            var method = MainActivity.class.getDeclaredMethod("openQueue");
            method.setAccessible(true);
            method.invoke(activity);
          } catch (Exception error) {
            throw new RuntimeException(error);
          }
        });
    SystemClock.sleep(500);
    capture(context, "native-queue.png");
    api.clear();
  }

  private void capture(Context context, String name) throws Exception {
    if (android.os.Build.VERSION.SDK_INT < 29) return;
    android.content.ContentValues values = new android.content.ContentValues();
    values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name);
    values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
    values.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MareTestEvidence");
    android.net.Uri uri =
        context
            .getContentResolver()
            .insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
    try (java.io.OutputStream out = context.getContentResolver().openOutputStream(uri)) {
      InstrumentationRegistry.getInstrumentation()
          .getUiAutomation()
          .takeScreenshot()
          .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
  }

  private boolean containsWebView(android.view.View view) {
    if (view instanceof android.webkit.WebView) return true;
    if (view instanceof android.view.ViewGroup) {
      android.view.ViewGroup group = (android.view.ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++)
        if (containsWebView(group.getChildAt(i))) return true;
    }
    return false;
  }

  @Test
  public void downloadingDoesNotCrashTheApplication() throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    Context context = instrumentation.getTargetContext();
    instrumentation.startActivitySync(
        new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    instrumentation.runOnMainSync(
        () -> {
          String command =
              MusicApi.json(
                      "action",
                      "download",
                      "origin",
                      "https://music.example",
                      "account",
                      "download-test",
                      "cookie",
                      "",
                      "tracks",
                      new org.json.JSONArray()
                          .put(
                              MusicApi.json(
                                  "id", "fixture", "title", "Download fixture", "status", "ready")),
                      "ids",
                      new org.json.JSONArray().put("fixture"))
                  .toString();
          context.startService(
              new Intent(context, PlaybackService.class)
                  .setAction("org.mare.music.COMMAND")
                  .putExtra("command", command));
        });
    SystemClock.sleep(6000);
    instrumentation.runOnMainSync(
        () -> {
          assertNotNull(PlaybackService.snapshot(context));
          AudioStore.manager(context)
              .removeDownload(
                  AudioStore.scope("https://music.example", "download-test") + "/fixture");
        });
  }

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
        new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
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
