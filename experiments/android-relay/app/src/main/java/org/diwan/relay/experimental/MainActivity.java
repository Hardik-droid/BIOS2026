package org.diwan.relay.experimental;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Explicit opt-in UI; no scanning, Internet, automatic pairing, or auto-start. */
public final class MainActivity extends Activity {
    private final List<BluetoothDevice> devices = new ArrayList<>();
    private Spinner upstream;
    private Spinner downstream;
    private CheckBox nextRelay;
    private CheckBox consent;
    private EditText nextCode;
    private TextView status;
    private TextView ownCode;
    private TextView counters;
    private Button start;
    private Button stop;
    private final Runnable observer = this::render;

    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size);
        view.setPadding(0, 10, 0, 10); parent.addView(view); return view;
    }
    private Button button(LinearLayout parent, String value, View.OnClickListener action) {
        Button view = new Button(this); view.setText(value); view.setOnClickListener(action); parent.addView(view); return view;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        scroll.addView(layout); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            scroll.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom()); return insets;
        });
        text(layout, "LocalFirst Relay Experiment", 25);
        text(layout, "Fixed-route hardware trial. Range and production security are not yet verified.", 16);
        text(layout, Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE + " · API " + Build.VERSION.SDK_INT, 14);
        text(layout, "Pair this phone with both adjacent devices in Android Bluetooth Settings first. Relay mode only works while this app’s foreground service is running.", 16);
        button(layout, "Allow Nearby devices and notifications", view -> requestAccess());
        button(layout, "Refresh paired devices", view -> refresh());
        text(layout, "Incoming device (allowed sender or previous relay)", 16);
        upstream = new Spinner(this); layout.addView(upstream);
        text(layout, "Outgoing device (document host or next relay)", 16);
        downstream = new Spinner(this); layout.addView(downstream);
        nextRelay = new CheckBox(this); nextRelay.setText(R.string.next_relay); layout.addView(nextRelay);
        nextCode = new EditText(this); nextCode.setHint("Next phone’s DRL1- relay code"); nextCode.setSingleLine(true);
        nextCode.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        nextCode.setSaveEnabled(false); nextCode.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        nextCode.setVisibility(View.GONE); layout.addView(nextCode);
        nextRelay.setOnCheckedChangeListener((view, checked) -> nextCode.setVisibility(checked ? View.VISIBLE : View.GONE));
        text(layout, "For a single phone between two Windows laptops, leave the next-relay option off. The outgoing laptop must be hosting the shared document.", 15);
        consent = new CheckBox(this); consent.setText(R.string.relay_consent); layout.addView(consent);
        start = button(layout, "Start experimental relay", view -> startRelay());
        stop = button(layout, "Stop relay", view -> { startService(new Intent(this, RelayService.class).setAction(RelayService.STOP)); });
        status = text(layout, "Relay is off.", 17); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        text(layout, "This phone’s relay access code", 16);
        ownCode = text(layout, "Start relay mode to generate a code.", 16); ownCode.setTextIsSelectable(true); ownCode.setSaveEnabled(false);
        ownCode.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        text(layout, "Give this DRL1- code only to the selected incoming device. Keep the host’s DBT1- document invitation on the two document endpoints; never enter it on a relay phone.", 15);
        counters = text(layout, "", 14);
        text(layout, "Forwarded bytes do not mean the destination saved your document. Verify acknowledgements in LocalFirst on both laptops. No distance estimate is shown because range has not been measured.", 15);
        refresh(); render();
    }
    private boolean hasBluetoothPermission() { return Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED; }
    private void requestAccess() {
        List<String> requested = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31 && !hasBluetoothPermission()) requested.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requested.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!requested.isEmpty()) requestPermissions(requested.toArray(new String[0]), 1);
        else if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) {
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        } else { status.setText(R.string.permissions_ready); refresh(); }
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) { super.onRequestPermissionsResult(requestCode, permissions, results); refresh(); }
    private void refresh() {
        if (upstream == null) return;
        if (RelayState.running) { render(); return; }
        devices.clear();
        List<String> labels = new ArrayList<>(); labels.add("Choose a paired device");
        try {
            BluetoothAdapter adapter = getSystemService(BluetoothManager.class).getAdapter();
            if (hasBluetoothPermission() && adapter != null && adapter.isEnabled()) {
                devices.addAll(adapter.getBondedDevices());
                devices.sort(Comparator.comparing(BluetoothDevice::getAddress));
                for (BluetoothDevice device : devices) labels.add((device.getName() == null ? "Paired device" : device.getName()) + " · " + device.getAddress());
            }
        } catch (SecurityException error) {
            devices.clear(); labels.clear(); labels.add(getString(R.string.choose_device));
            status.setText(R.string.bluetooth_permission_removed);
        } catch (RuntimeException error) { status.setText(R.string.bluetooth_unavailable); }
        ArrayAdapter<String> choices = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        choices.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        upstream.setAdapter(choices); downstream.setAdapter(choices);
    }
    private void startRelay() {
        try {
            if (!hasBluetoothPermission()) throw new IllegalArgumentException("Allow Nearby devices first.");
            if (!consent.isChecked()) throw new IllegalArgumentException("Select the devices and enable the consent checkbox first.");
            int from = upstream.getSelectedItemPosition() - 1;
            int to = downstream.getSelectedItemPosition() - 1;
            if (from < 0 || to < 0 || from >= devices.size() || to >= devices.size() || from == to) throw new IllegalArgumentException("Choose two different paired devices.");
            String code = nextCode.getText().toString().trim();
            if (nextRelay.isChecked()) RelayCore.decode(code);
            Intent intent = new Intent(this, RelayService.class).putExtra("upstream", devices.get(from).getAddress()).putExtra("downstream", devices.get(to).getAddress()).putExtra("nextIsRelay", nextRelay.isChecked());
            if (nextRelay.isChecked()) intent.putExtra("nextCode", code);
            startForegroundService(intent);
            nextCode.setText(""); consent.setChecked(false);
        } catch (IllegalArgumentException error) { status.setText(error.getMessage()); }
        catch (SecurityException error) { status.setText(R.string.bluetooth_permission_removed); }
        catch (RuntimeException error) { status.setText(R.string.relay_start_failed); }
    }
    private void render() {
        if (status == null) return;
        status.setText(RelayState.status);
        ownCode.setText(RelayState.code.isEmpty() ? "Start relay mode to generate a code." : RelayState.code);
        counters.setText(getString(R.string.circuit_counters, RelayState.sent, RelayState.received));
        start.setEnabled(!RelayState.running); stop.setEnabled(RelayState.running);
        upstream.setEnabled(!RelayState.running); downstream.setEnabled(!RelayState.running);
        nextRelay.setEnabled(!RelayState.running); nextCode.setEnabled(!RelayState.running); consent.setEnabled(!RelayState.running);
    }
    @Override public void onStart() { super.onStart(); RelayState.observers.add(observer); render(); }
    @Override public void onStop() { RelayState.observers.remove(observer); super.onStop(); }
}
