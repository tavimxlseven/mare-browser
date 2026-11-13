package org.mare.music;

import android.content.Context;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.*;
import androidx.media3.exoplayer.offline.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import org.json.JSONArray;

@UnstableApi
final class AudioStore {
  private static SimpleCache cache;
  private static DownloadManager manager;
  static DefaultHttpDataSource.Factory http =
      new DefaultHttpDataSource.Factory()
          .setConnectTimeoutMs(15000)
          .setReadTimeoutMs(30000)
          .setAllowCrossProtocolRedirects(false);

  static synchronized DownloadManager manager(Context context) {
    if (manager == null) {
      StandaloneDatabaseProvider db = new StandaloneDatabaseProvider(context);
      cache = new SimpleCache(new File(context.getFilesDir(), "audio"), new NoOpCacheEvictor(), db);
      manager = new DownloadManager(context, db, cache, http, Executors.newFixedThreadPool(2));
      manager.setMaxParallelDownloads(2);
    }
    return manager;
  }

  static CacheDataSource.Factory source(Context context) {
    manager(context);
    return new CacheDataSource.Factory()
        .setCache(cache)
        .setUpstreamDataSourceFactory(new DefaultDataSource.Factory(context, http))
        .setCacheWriteDataSinkFactory(null);
  }

  static void authenticate(String cookie) {
    http.setDefaultRequestProperties(
        cookie.isEmpty()
            ? java.util.Collections.emptyMap()
            : java.util.Collections.singletonMap("Cookie", cookie));
  }

  static String scope(String origin, String account) {
    try {
      byte[] bytes =
          MessageDigest.getInstance("SHA-256")
              .digest((origin + "\n" + account).getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder();
      for (byte b : bytes) result.append(String.format("%02x", b));
      return result.toString();
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  static JSONArray completed(Context context, String scope) {
    return byState(context, scope, Download.STATE_COMPLETED);
  }

  static JSONArray byState(Context context, String scope, int state) {
    JSONArray result = new JSONArray();
    try (DownloadCursor cursor = manager(context).getDownloadIndex().getDownloads(state)) {
      while (cursor.moveToNext()) {
        String id = cursor.getDownload().request.id;
        if (id.startsWith(scope + "/")) result.put(id.substring(scope.length() + 1));
      }
    } catch (Exception ignored) {
    }
    return result;
  }

  static void clearAccount(Context context, String scope) {
    try (DownloadCursor cursor = manager(context).getDownloadIndex().getDownloads()) {
      while (cursor.moveToNext()) {
        String id = cursor.getDownload().request.id;
        if (id.startsWith(scope + "/")) manager(context).removeDownload(id);
      }
    } catch (Exception ignored) {
    }
  }
}
