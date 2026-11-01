# LocalFirst fixed-route Android relay experiment

This is a separate development artifact, not a production release or a measured-range claim. The known working Windows app stays on port 8765 and its existing ZIP/launcher is unchanged. The experimental Windows receiver uses port 8768 and a separate browser document store. The Android app is a relay only; it is not an Android document editor.

Available test hardware reported by the user: two Windows laptops, a Samsung A36 and a OnePlus Nord. Exact phone variants, Android builds, Bluetooth adapter/driver versions and simultaneous-link behavior have not yet been measured. The Android screen displays its actual model and Android/API version. No phone is marked supported merely from its model name.

## First physical trial: Windows host → phone → Windows receiver

1. Install the experimental APK on one phone. Pair that phone with both laptops through their OS Bluetooth Settings. Grant Nearby devices and notification access in the app. No location, Internet, scanning, storage or contacts permissions are requested.
2. On the hosting laptop use the existing working LocalFirst release, open a small test document, choose Bluetooth → Share this document, and keep it open. Transfer its **DBT1 document invitation directly to the receiver laptop**. Never put DBT1 on a relay phone.
3. On the phone choose the receiver laptop as **Incoming device**, and the hosting laptop as **Outgoing device**. Leave **Outgoing device is another LocalFirst relay phone** off. Check explicit consent and choose **Start experimental relay**. An ongoing notification must show Stop.
4. The phone shows a new **DRL1 relay access code**. Give that code to the incoming receiver laptop. This code admits a byte stream to this phone; it is not a document key or document invitation.
5. On the receiver laptop extract the complete experimental Windows package and run `Start-Relay-Windows-Experiment.cmd`. Enter the phone's DRL1 code at the hidden prompt. It opens `http://127.0.0.1:8768` with an experimental banner. In Bluetooth sharing select the paired **phone**, then enter the original host's **DBT1** document invitation. Choose Connect over Bluetooth and Open shared document.
6. Make a harmless edit in each direction. Check actual endpoint journal acknowledgements and equivalent contents on both laptops. A phone byte counter or connected radio is not proof that a document was committed.
7. Disable Wi-Fi/mobile data for the trial and verify that Bluetooth continues. Stop the phone relay, edit locally at both endpoints, restart relay explicitly, relaunch the experimental receiver with the new DRL1 code, then reconnect and check convergence. The old DRL1 code must fail after restart. Record the results; these steps have not been performed remotely.

## Second phone / longer fixed chain

Work from the host backwards. Phone B chooses incoming Phone A and outgoing host laptop, with next-relay off. Start B. Phone A chooses incoming receiver laptop and outgoing Phone B, enables next-relay and enters B's DRL1 code. Start A and give A's DRL1 code to the receiver's experimental launcher. Transfer DBT1 directly between laptops as before. Pair adjacent devices beforehand. Each phone's owner chooses both neighbors; clients cannot request arbitrary destinations. There is no automatic route discovery or rerouting yet.

## Protocol and limits

The relay uses secure, paired Classic RFCOMM and a separate relay service UUID `5bb53883-7094-461b-9d28-f7189bb4cb62`. The document service UUID remains `d71a5670-e6ec-4a22-87f1-b0ed9b5dc321`. Admission is exactly `DRL1` plus a random 32-byte relay token, followed by a one-byte ready indication only after the next socket/relay is ready. Admission is carried inside OS-secured paired links. The selected incoming Bluetooth address and bonded state are checked; the application admission token is not a replacement for paired-link security.

After admission, the original certificate-pinned TLS document session runs directly between the two Windows endpoints. Relays do not terminate that TLS session, receive DBT1, parse document frames or store payloads. Relays still observe neighbors, traffic sizes and timings. A compromised relay can deny service. This design has not received independent security review.

Experimental limits: one active circuit per phone, 16 KiB buffers per direction, a shared 64 MiB budget per circuit, 30-minute relay lifetime, 12-second setup and 30-second inactivity deadlines checked once per second. Windows document limits and invitation lifetime remain unchanged. No wake lock or battery-optimization exemption is requested, so Android power management may interrupt relaying. Reconnection needs a still-valid invitation; restarting a phone relay generates a fresh DRL1 code and the receiver launcher must be restarted with that code. Stop the previous experimental server before relaunching on port 8768. Never stop the working app on port 8765 as part of this experiment.

## Development checks and open gates

`RelayCoreTest` exercises bounded admission, exact opaque-byte forwarding, invalid/truncated credentials, failed writes and shared concurrent byte budgets on the JVM. Go tests validate the Windows admission codec and cancellation. These are software checks, not physical radio, Android lifecycle or end-to-end document delivery results. Android framework/service permissions and resource handling still require device testing.

The experimental connector is guarded by Go's `relay_experiment` build tag. The normal Windows build excludes it. The Android application ID is `org.diwan.relay.experimental` and the SDK/build files live only under this experiment. No automatic activation of either prototype is performed.

Hardware acceptance remains open for both phone models: secure pairing, two simultaneous links, Bluetooth-off and permission revocation, rejected peers, setup/idle expiry, byte limit, screen off, battery saver, force-stop, process death, repeated reconnect, corrupted records, destination-only acknowledgements, formatted concurrent edits and full offline recovery. 800 m/1 km range, dynamic routing, performance, battery endurance and production certification remain later gates in the main phase plan.
