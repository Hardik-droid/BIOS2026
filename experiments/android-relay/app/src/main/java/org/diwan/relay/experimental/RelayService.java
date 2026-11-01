package org.diwan.relay.experimental;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** One fixed, explicitly selected circuit; no document keys or content parsing. */
public final class RelayService extends Service {
    static final String STOP = "org.diwan.relay.experimental.STOP";
    private final AtomicBoolean running = new AtomicBoolean();
    private final ExecutorService acceptor = Executors.newSingleThreadExecutor();
    private final ExecutorService copies = Executors.newFixedThreadPool(2);
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    private final Object resourceLock = new Object();
    private volatile BluetoothServerSocket listener;
    private volatile Circuit active;
    private byte[] token;
    private byte[] nextToken;
    private long expires;
    private String allowedAddress;
    private String nextAddress;
    private boolean nextIsRelay;

    private static final class Circuit {
        final BluetoothSocket incoming;
        volatile BluetoothSocket outgoing;
        final AtomicBoolean closed = new AtomicBoolean();
        final RelayCore.Budget budget = new RelayCore.Budget(RelayCore.BYTE_LIMIT);
        final AtomicLong forward = new AtomicLong();
        final AtomicLong backward = new AtomicLong();
        final long setupDeadline = SystemClock.elapsedRealtime() + RelayCore.SETUP_MS;
        volatile long lastActivity = SystemClock.elapsedRealtime();
        volatile boolean ready;
        Circuit(BluetoothSocket incoming) { this.incoming = incoming; }
        synchronized void attach(BluetoothSocket socket) throws IOException {
            if (closed.get()) { socket.close(); throw new IOException("Circuit ended."); }
            outgoing = socket;
        }
        synchronized void close() {
            if (!closed.compareAndSet(false, true)) return;
            closeSocket(incoming);
            closeSocket(outgoing);
        }
    }

    private static void closeSocket(BluetoothSocket socket) {
        if (socket != null) try { socket.close(); } catch (IOException | RuntimeException ignored) { }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { stopRelay("Relay is off."); return START_NOT_STICKY; }
        if (running.get()) return START_NOT_STICKY;
        try {
            if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) throw new IllegalArgumentException("Allow Nearby devices before starting.");
            NotificationManager notifications = getSystemService(NotificationManager.class);
            if (!notifications.areNotificationsEnabled()) throw new IllegalArgumentException("Allow notifications so relay activity stays visible.");
            allowedAddress = intent.getStringExtra("upstream");
            nextAddress = intent.getStringExtra("downstream");
            nextIsRelay = intent.getBooleanExtra("nextIsRelay", false);
            if (!BluetoothAdapter.checkBluetoothAddress(allowedAddress) || !BluetoothAdapter.checkBluetoothAddress(nextAddress) || allowedAddress.equals(nextAddress)) throw new IllegalArgumentException("Choose two different paired devices.");
            if (nextIsRelay) nextToken = RelayCore.decode(intent.getStringExtra("nextCode"));
            intent.replaceExtras((android.os.Bundle) null);
            BluetoothAdapter adapter = getSystemService(BluetoothManager.class).getAdapter();
            if (adapter == null || !adapter.isEnabled()) throw new IllegalArgumentException("Turn on Bluetooth first.");
            if (adapter.getRemoteDevice(allowedAddress).getBondState() != BluetoothDevice.BOND_BONDED || adapter.getRemoteDevice(nextAddress).getBondState() != BluetoothDevice.BOND_BONDED) throw new IllegalArgumentException("Pair both adjacent devices in Android Settings first.");
            notifications.createNotificationChannel(new NotificationChannel("relay", "Active Bluetooth relay", NotificationManager.IMPORTANCE_LOW));
            Notification notification = notification();
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            else startForeground(1, notification);
            token = RelayCore.newToken();
            RelayState.code = RelayCore.encode(token);
            expires = SystemClock.elapsedRealtime() + RelayCore.LIFETIME_MS;
            running.set(true); RelayState.running = true;
            RelayState.sent = 0; RelayState.received = 0;
            RelayState.status("Starting the experimental Bluetooth relay…");
            acceptor.execute(() -> accept(adapter));
            watchdog.scheduleWithFixedDelay(this::checkLimits, 1, 1, TimeUnit.SECONDS);
        } catch (IllegalArgumentException error) { stopRelay(error.getMessage()); }
        catch (SecurityException error) { stopRelay(getString(R.string.bluetooth_permission_removed)); }
        catch (RuntimeException error) { stopRelay("Android could not start the relay. Check Bluetooth and notification permissions."); }
        return START_NOT_STICKY;
    }

    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, RelayService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "relay").setContentTitle("LocalFirst experimental relay is on")
            .setContentText("Bluetooth forwarding is enabled. Tap Stop to end it.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentIntent(open)
            .setOngoing(true).addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build();
    }

    private void accept(BluetoothAdapter adapter) {
        Deque<Long> attempts = new ArrayDeque<>();
        try {
            BluetoothServerSocket server = adapter.listenUsingRfcommWithServiceRecord("LocalFirst experimental encrypted relay", RelayCore.RELAY_SERVICE);
            synchronized (resourceLock) {
                if (!running.get()) { server.close(); return; }
                listener = server;
            }
            RelayState.status("Waiting for the selected incoming device. No document delivery is implied.");
            while (running.get()) {
                BluetoothSocket incoming = server.accept();
                Circuit circuit = new Circuit(incoming);
                synchronized (resourceLock) {
                    if (!running.get()) { circuit.close(); break; }
                    active = circuit;
                }
                try {
                    // Own the accepted socket before calls that may fail after
                    // a Bluetooth permission revocation or radio transition.
                    long now = SystemClock.elapsedRealtime();
                    while (!attempts.isEmpty() && now - attempts.peekFirst() >= 60_000) attempts.removeFirst();
                    if (attempts.size() >= 8 || !allowedAddress.equals(incoming.getRemoteDevice().getAddress()) || incoming.getRemoteDevice().getBondState() != BluetoothDevice.BOND_BONDED) continue;
                    attempts.addLast(now);
                    RelayCore.authenticate(incoming.getInputStream(), token);
                    BluetoothDevice next = adapter.getRemoteDevice(nextAddress);
                    if (next.getBondState() != BluetoothDevice.BOND_BONDED) throw new IOException("Pairing ended.");
                    UUID service = nextIsRelay ? RelayCore.RELAY_SERVICE : RelayCore.DOCUMENT_SERVICE;
                    BluetoothSocket outgoing = next.createRfcommSocketToServiceRecord(service);
                    circuit.attach(outgoing);
                    outgoing.connect();
                    if (nextIsRelay) RelayCore.openNextRelay(outgoing.getOutputStream(), outgoing.getInputStream(), nextToken);
                    incoming.getOutputStream().write(1); incoming.getOutputStream().flush();
                    circuit.ready = true; circuit.lastActivity = SystemClock.elapsedRealtime();
                    RelayState.status("Forwarding an opaque stream. Check delivery status on the document endpoints.");
                    CountDownLatch done = new CountDownLatch(2);
                    copies.execute(() -> copy(circuit, true, done));
                    copies.execute(() -> copy(circuit, false, done));
                    done.await();
                    if (running.get()) RelayState.status("The link ended. Waiting for the selected incoming device; delivery must be checked at the endpoints.");
                } catch (SecurityException error) {
                    stopRelay(getString(R.string.bluetooth_permission_removed));
                } catch (IOException | RuntimeException error) {
                    if (running.get()) RelayState.status("The link ended or access was rejected. The endpoints retain their local documents.");
                } finally {
                    circuit.close();
                    RelayState.sent = circuit.forward.get(); RelayState.received = circuit.backward.get();
                    RelayState.changed();
                    synchronized (resourceLock) { if (active == circuit) active = null; }
                }
            }
        } catch (SecurityException error) {
            stopRelay(getString(R.string.bluetooth_permission_removed));
        } catch (IOException | RuntimeException error) {
            if (running.get()) stopRelay("Bluetooth listening stopped. Check radio and permissions, then restart explicitly.");
        } catch (InterruptedException error) { Thread.currentThread().interrupt(); stopRelay("Relay stopped."); }
    }
    private void copy(Circuit circuit, boolean forward, CountDownLatch done) {
        try {
            BluetoothSocket source = forward ? circuit.incoming : circuit.outgoing;
            BluetoothSocket target = forward ? circuit.outgoing : circuit.incoming;
            RelayCore.copy(source.getInputStream(), target.getOutputStream(), circuit.budget, forward ? circuit.forward : circuit.backward, () -> circuit.lastActivity = SystemClock.elapsedRealtime());
        } catch (IOException | RuntimeException ignored) { /* No payload or secret logging. */ }
        finally { circuit.close(); done.countDown(); }
    }
    private void checkLimits() {
        if (!running.get()) return;
        if (SystemClock.elapsedRealtime() >= expires) { stopRelay("Relay session expired. Start again to generate a fresh relay code."); return; }
        Circuit circuit = active;
        if (circuit != null) {
            long now = SystemClock.elapsedRealtime();
            if ((!circuit.ready && now >= circuit.setupDeadline) || (circuit.ready && now - circuit.lastActivity >= RelayCore.IDLE_MS)) circuit.close();
            RelayState.sent = circuit.forward.get(); RelayState.received = circuit.backward.get(); RelayState.changed();
        }
    }
    private void stopRelay(String reason) {
        running.set(false);
        synchronized (resourceLock) {
            if (listener != null) try { listener.close(); } catch (IOException | RuntimeException ignored) { }
            if (active != null) active.close();
        }
        RelayState.running = false; RelayState.code = ""; RelayState.status(reason);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }
    @Override public void onDestroy() {
        running.set(false);
        synchronized (resourceLock) {
            if (listener != null) try { listener.close(); } catch (IOException | RuntimeException ignored) { }
            if (active != null) active.close();
        }
        acceptor.shutdownNow(); copies.shutdownNow(); watchdog.shutdownNow();
        if (token != null) Arrays.fill(token, (byte) 0);
        if (nextToken != null) Arrays.fill(nextToken, (byte) 0);
        RelayState.running = false; RelayState.code = ""; RelayState.changed();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
