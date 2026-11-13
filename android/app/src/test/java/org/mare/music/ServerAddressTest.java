package org.mare.music;

import static org.junit.Assert.*;

import org.junit.Test;

public class ServerAddressTest {
  @Test
  public void normalizesServerWithoutShippingAHost() {
    assertEquals("https://music.example", ServerAddress.normalize("music.example/"));
  }

  @Test
  public void rejectsCrossOriginAndPlaintext() {
    assertFalse(ServerAddress.sameOrigin("https://music.example", "http://music.example/media/a"));
    assertFalse(
        ServerAddress.sameOrigin("https://music.example", "https://music.example.evil/media/a"));
    assertFalse(
        ServerAddress.sameOrigin("https://music.example", "https://music.example:8443/media/a"));
    assertTrue(
        ServerAddress.sameOrigin("https://music.example", "https://music.example:443/media/a"));
  }

  @Test
  public void rejectsCredentialAndPathInput() {
    for (String value :
        new String[] {
          "http://music.example",
          "https://user:pass@music.example",
          "https://music.example/path",
          "https://music.example?token=x"
        }) {
      try {
        ServerAddress.normalize(value);
        fail(value);
      } catch (IllegalArgumentException expected) {
      }
    }
  }
}
