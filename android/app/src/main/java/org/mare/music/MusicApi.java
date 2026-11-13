package org.mare.music;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

final class MusicApi {
  final Context context;
  String origin, cookie = "", account = "";

  MusicApi(Context context) {
    this.context = context;
    origin = context.getSharedPreferences("native-account", 0).getString("origin", "");
    restore();
  }

  private javax.crypto.SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias("mare-session")) {
      KeyGenerator gen = KeyGenerator.getInstance("AES", "AndroidKeyStore");
      gen.init(
          new KeyGenParameterSpec.Builder(
                  "mare-session", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build());
      gen.generateKey();
    }
    return (javax.crypto.SecretKey) store.getKey("mare-session", null);
  }

  void persist() throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    String value =
        Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
            + ":"
            + Base64.encodeToString(
                cipher.doFinal((account + "\n" + cookie).getBytes(StandardCharsets.UTF_8)),
                Base64.NO_WRAP);
    context
        .getSharedPreferences("native-account", 0)
        .edit()
        .putString("origin", origin)
        .putString("session", value)
        .apply();
  }

  private void restore() {
    try {
      String[] value =
          context.getSharedPreferences("native-account", 0).getString("session", "").split(":");
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          key(),
          new GCMParameterSpec(128, Base64.decode(value[0], Base64.NO_WRAP)));
      String[] plain =
          new String(
                  cipher.doFinal(Base64.decode(value[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)
              .split("\n", 2);
      account = plain[0];
      cookie = plain[1];
    } catch (Exception ignored) {
      cookie = "";
      account = "";
    }
  }

  void clear() {
    cookie = "";
    account = "";
    context.getSharedPreferences("native-account", 0).edit().remove("session").apply();
  }

  JSONObject call(String path, JSONObject data) throws Exception {
    if (origin.isEmpty()) throw new IOException("Informe seu servidor para continuar.");
    HttpURLConnection connection =
        (HttpURLConnection) new URL(origin + "/api/" + path).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(12000);
    connection.setReadTimeout(90000);
    connection.setRequestProperty("Cookie", cookie);
    connection.setRequestProperty("Origin", origin);
    connection.setRequestProperty("Accept", "application/json");
    try {
      if (data != null) {
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = connection.getOutputStream()) {
          out.write(data.toString().getBytes(StandardCharsets.UTF_8));
        }
      }
      int status = connection.getResponseCode();
      InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      if (stream != null)
        try (InputStream in = stream) {
          byte[] buffer = new byte[8192];
          int n;
          while ((n = in.read(buffer)) != -1) {
            bytes.write(buffer, 0, n);
            if (bytes.size() > 8 * 1024 * 1024) throw new IOException("Resposta muito grande.");
          }
        }
      JSONObject response;
      try {
        response = new JSONObject(bytes.toString("UTF-8"));
      } catch (JSONException error) {
        throw new IOException(
            "O servidor não respondeu como um servidor Maré. Confira o endereço.");
      }
      if (status >= 400)
        throw new IOException(
            status == 401
                ? "Sua sessão expirou. Entre novamente."
                : response.optString("error", "Não foi possível concluir. Tente novamente."));
      String set = connection.getHeaderField("Set-Cookie");
      if (set != null && !set.isEmpty()) cookie = set.split(";", 2)[0];
      return response;
    } catch (java.net.UnknownHostException error) {
      throw new IOException("Sem conexão. Suas músicas baixadas continuam disponíveis.");
    } catch (java.net.SocketTimeoutException error) {
      throw new IOException("O servidor demorou para responder. Tente novamente.");
    } finally {
      connection.disconnect();
    }
  }

  static JSONObject json(Object... pairs) {
    JSONObject value = new JSONObject();
    try {
      for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]);
    } catch (JSONException error) {
      throw new IllegalArgumentException(error);
    }
    return value;
  }
}
