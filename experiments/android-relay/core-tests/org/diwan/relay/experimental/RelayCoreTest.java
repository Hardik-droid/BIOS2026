package org.diwan.relay.experimental;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

public final class RelayCoreTest {
    private static int cases;
    private static void check(boolean condition, String name) { if (!condition) throw new AssertionError(name); cases++; }
    private static void rejects(Action action, String name) throws Exception {
        boolean rejected = false;
        try { action.run(); } catch (IOException | IllegalArgumentException expected) { rejected = true; }
        check(rejected, name);
    }
    private interface Action { void run() throws Exception; }
    public static void main(String[] args) throws Exception {
        byte[] token = RelayCore.newToken();
        String code = RelayCore.encode(token);
        check(code.length() == 48 && code.startsWith("DRL1-"), "relay code format");
        check(Arrays.equals(token, RelayCore.decode(code)), "code round trip");
        check(!Arrays.equals(token, RelayCore.newToken()), "fresh sessions generate distinct tokens");
        for (String invalid : new String[] { "", "DBT1-" + "A".repeat(86), code + "=", "DRL1-" + "B".repeat(43), "DRL1-" + "!".repeat(43) }) rejects(() -> RelayCore.decode(invalid), "invalid code rejected");
        ByteArrayOutputStream admission = new ByteArrayOutputStream();
        RelayCore.openNextRelay(admission, new ByteArrayInputStream(new byte[] {1}), token);
        byte[] header = admission.toByteArray();
        check(header.length == 36, "bounded admission header");
        RelayCore.authenticate(new ByteArrayInputStream(header), token);
        check(true, "matching admission accepted");
        for (int i = 0; i < header.length; i++) {
            byte[] changed = header.clone(); changed[i] ^= 1;
            rejects(() -> RelayCore.authenticate(new ByteArrayInputStream(changed), token), "changed magic/token rejected");
        }
        for (int i = 0; i < header.length; i++) {
            byte[] truncated = Arrays.copyOf(header, i);
            rejects(() -> RelayCore.authenticate(new ByteArrayInputStream(truncated), token), "truncated admission rejected");
        }
        rejects(() -> RelayCore.openNextRelay(new ByteArrayOutputStream(), new ByteArrayInputStream(new byte[] {0}), token), "false ready rejected");
        rejects(() -> RelayCore.openNextRelay(new ByteArrayOutputStream(), new ByteArrayInputStream(new byte[0]), token), "missing ready rejected");
        InputStream stalled = new InputStream() { public int read() { return 0; } public int read(byte[] data, int offset, int length) { return 0; } };
        rejects(() -> RelayCore.readFully(stalled, new byte[1]), "zero-progress admission rejected");
        byte[] payload = new byte[81920]; new java.security.SecureRandom().nextBytes(payload);
        ByteArrayOutputStream destination = new ByteArrayOutputStream();
        AtomicLong forwarded = new AtomicLong();
        RelayCore.Budget budget = new RelayCore.Budget(payload.length);
        RelayCore.copy(new ByteArrayInputStream(payload), destination, budget, forwarded, () -> {});
        check(Arrays.equals(payload, destination.toByteArray()), "exact opaque bytes preserved");
        check(forwarded.get() == payload.length && budget.used() == payload.length, "successful counters match");
        ByteArrayOutputStream rejectedDestination = new ByteArrayOutputStream();
        rejects(() -> RelayCore.copy(new ByteArrayInputStream(payload), rejectedDestination, new RelayCore.Budget(100), new AtomicLong(), () -> {}), "over-budget chunk rejected");
        check(rejectedDestination.size() == 0, "no over-budget bytes forwarded");
        AtomicLong failedForwarded = new AtomicLong();
        OutputStream failing = new OutputStream() { public void write(int value) throws IOException { throw new IOException("Synthetic write failure"); } };
        rejects(() -> RelayCore.copy(new ByteArrayInputStream(new byte[] {1}), failing, new RelayCore.Budget(1), failedForwarded, () -> {}), "write failure propagates");
        check(failedForwarded.get() == 0, "failed output does not report successful forwarding");
        RelayCore.Budget shared = new RelayCore.Budget(97);
        AtomicInteger successful = new AtomicInteger();
        Thread[] threads = new Thread[16];
        for (int i = 0; i < threads.length; i++) {
            threads[i] = new Thread(() -> { for (int attempt = 0; attempt < 100; attempt++) { try { shared.reserve(1); successful.incrementAndGet(); } catch (IOException expected) { break; } } });
            threads[i].start();
        }
        for (Thread thread : threads) thread.join(2000);
        check(successful.get() == 97 && shared.used() == 97, "concurrent directions share an exact bound");
        for (Thread thread : threads) check(!thread.isAlive(), "budget workers stop");
        System.out.println("{\"passed\":true,\"checks\":" + cases + ",\"physicalBluetoothVerified\":false}");
    }
}
