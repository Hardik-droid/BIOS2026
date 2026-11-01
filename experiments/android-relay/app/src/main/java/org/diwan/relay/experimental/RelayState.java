package org.diwan.relay.experimental;

import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.CopyOnWriteArraySet;

final class RelayState {
    static volatile boolean running;
    static volatile String status = "Relay is off.";
    static volatile String code = "";
    static volatile long sent;
    static volatile long received;
    static final CopyOnWriteArraySet<Runnable> observers = new CopyOnWriteArraySet<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    static void changed() { for (Runnable observer : observers) main.post(observer); }
    static void status(String value) { status = value; changed(); }
    private RelayState() {}
}
