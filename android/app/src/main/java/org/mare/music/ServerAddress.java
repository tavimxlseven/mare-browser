package org.mare.music;

import java.net.URI;

final class ServerAddress {
  static String normalize(String value) {
    String input = value.trim();
    if (!input.contains("://")) input = "https://" + input;
    URI uri = URI.create(input);
    if (!"https".equals(uri.getScheme())
        || uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getRawQuery() != null
        || uri.getRawFragment() != null
        || !(uri.getPath().isEmpty() || "/".equals(uri.getPath())))
      throw new IllegalArgumentException("Use somente o endereço HTTPS do servidor.");
    return "https://" + uri.getRawAuthority().toLowerCase(java.util.Locale.ROOT);
  }

  static boolean sameOrigin(String origin, String url) {
    try {
      URI a = URI.create(origin), b = URI.create(url);
      return "https".equals(b.getScheme())
          && a.getHost().equalsIgnoreCase(b.getHost())
          && (a.getPort() == -1 ? 443 : a.getPort()) == (b.getPort() == -1 ? 443 : b.getPort())
          && b.getUserInfo() == null;
    } catch (RuntimeException error) {
      return false;
    }
  }
}
