package org.diwan.relay.experimental;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/** Routing admission only. The document TLS session passes through unchanged. */
public final class RelayCore {
    public static final UUID RELAY_SERVICE = UUID.fromString("5bb53883-7094-461b-9d28-f7189bb4cb62");
    public static final UUID DOCUMENT_SERVICE = UUID.fromString("d71a5670-e6ec-4a22-87f1-b0ed9b5dc321");
    public static final long BYTE_LIMIT = 64L * 1024 * 1024;
    public static final long LIFETIME_MS = 30L * 60 * 1000;
    public static final long IDLE_MS = 30_000;
    public static final long SETUP_MS = 12_000;
    private static final byte[] MAGIC = new byte[] { 'D', 'R', 'L', '1' };
    private RelayCore() {}

    public static byte[] newToken() { byte[] token = new byte[32]; new SecureRandom().nextBytes(token); return token; }
    public static String encode(byte[] token) {
        if (token.length != 32) throw new IllegalArgumentException("Invalid relay token.");
        return "DRL1-" + Base64.getUrlEncoder().withoutPadding().encodeToString(token);
    }
    public static byte[] decode(String code) {
        if (code == null || !code.matches("DRL1-[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Enter the complete DRL1- relay code. Do not enter a document invitation.");
        byte[] token;
        try { token = Base64.getUrlDecoder().decode(code.substring(5)); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid relay code."); }
        if (token.length != 32 || !encode(token).equals(code)) throw new IllegalArgumentException("Invalid relay code.");
        return token;
    }
    public static void readFully(InputStream source, byte[] data) throws IOException {
        int offset = 0;
        while (offset < data.length) {
            int read = source.read(data, offset, data.length - offset);
            if (read < 0) throw new EOFException("Relay setup ended.");
            if (read == 0) throw new IOException("Relay stream made no progress.");
            offset += read;
        }
    }
    public static void authenticate(InputStream source, byte[] token) throws IOException {
        if (token.length != 32) throw new IOException("Invalid relay policy.");
        byte[] header = new byte[36];
        try {
            readFully(source, header);
            byte[] supplied = Arrays.copyOfRange(header, 4, 36);
            try {
                if (!Arrays.equals(MAGIC, Arrays.copyOfRange(header, 0, 4)) || !MessageDigest.isEqual(token, supplied)) throw new IOException("Relay access rejected.");
            } finally { Arrays.fill(supplied, (byte) 0); }
        } finally { Arrays.fill(header, (byte) 0); }
    }
    public static void openNextRelay(OutputStream target, InputStream source, byte[] token) throws IOException {
        if (token.length != 32) throw new IOException("Invalid relay policy.");
        target.write(MAGIC); target.write(token); target.flush();
        if (source.read() != 1) throw new IOException("Next relay was not ready.");
    }

    /** A shared atomic byte budget bounds both directions of a single circuit. */
    public static final class Budget {
        private final long limit;
        private final AtomicLong reserved = new AtomicLong();
        public Budget(long limit) { if (limit <= 0) throw new IllegalArgumentException("Invalid byte limit."); this.limit = limit; }
        void reserve(int bytes) throws IOException {
            while (true) {
                long current = reserved.get();
                if (bytes < 0 || bytes > limit - current) throw new IOException("Relay byte limit reached.");
                if (reserved.compareAndSet(current, current + bytes)) return;
            }
        }
        public long used() { return reserved.get(); }
    }
    public static void copy(InputStream source, OutputStream target, Budget budget, AtomicLong forwarded, Runnable activity) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        try {
            while (true) {
                int read = source.read(buffer);
                if (read < 0) return;
                if (read == 0) throw new IOException("Relay stream made no progress.");
                budget.reserve(read);
                target.write(buffer, 0, read);
                forwarded.addAndGet(read);
                activity.run();
            }
        } finally { Arrays.fill(buffer, (byte) 0); }
    }
}
