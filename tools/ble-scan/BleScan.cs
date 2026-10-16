// Passive BLE advertisement scanner for Windows.
//
// Listens only: never connects, pairs, reads or writes. Diagnostic lines start
// with '#'. Otherwise emits one tab-separated line per device seen:
//   address \t names(;) \t serviceUuids(;) \t rssiMedian \t advertisementCount
//
// Built by tools/ble-scan.ps1 with the .NET Framework csc.exe against the WinRT
// metadata that ships with Windows, so it needs no SDK or package.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Windows.Devices.Bluetooth.Advertisement;

public static class BleScan
{
    class Seen
    {
        public HashSet<string> Names = new HashSet<string>();
        public HashSet<string> Services = new HashSet<string>();
        public List<short> Rssi = new List<short>();
    }

    public static int Main(string[] args)
    {
        int seconds = args.Length > 0 ? int.Parse(args[0]) : 20;
        var map = new Dictionary<ulong, Seen>();

        var watcher = new BluetoothLEAdvertisementWatcher();
        watcher.ScanningMode = BluetoothLEScanningMode.Active;
        // WinRT events compile with ordinary += syntax provided the
        // System.Runtime.InteropServices.WindowsRuntime facade is referenced;
        // without it csc reports CS1545 and suggests accessor calls instead.
        watcher.Received += new Windows.Foundation.TypedEventHandler<
            BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementReceivedEventArgs>((s, e) =>
        {
            lock (map)
            {
                Seen d;
                if (!map.TryGetValue(e.BluetoothAddress, out d)) { d = new Seen(); map[e.BluetoothAddress] = d; }
                if (!string.IsNullOrEmpty(e.Advertisement.LocalName)) d.Names.Add(e.Advertisement.LocalName);
                foreach (var u in e.Advertisement.ServiceUuids) d.Services.Add(u.ToString().ToLowerInvariant());
                d.Rssi.Add(e.RawSignalStrengthInDBm);
            }
        });

        try { watcher.Start(); }
        catch (Exception ex)
        {
            Console.WriteLine("#ERROR\t" + ex.GetType().Name + "\t" + ex.Message);
            return 2;
        }
        Thread.Sleep(seconds * 1000);
        // Status before Stop() distinguishes a healthy scan (Started) from a radio
        // that was off or denied access (Aborted).
        Console.WriteLine("#STATUS\t" + watcher.Status);
        watcher.Stop();

        lock (map)
        {
            foreach (var kv in map)
            {
                var r = kv.Value.Rssi.OrderBy(x => x).ToList();
                string mac = string.Join(":", Enumerable.Range(0, 6)
                    .Select(i => ((kv.Key >> (8 * (5 - i))) & 0xFF).ToString("X2")));
                Console.WriteLine(string.Join("\t", new[] {
                    mac,
                    string.Join(";", kv.Value.Names.Select(n => n.Replace("\t", " "))),
                    string.Join(";", kv.Value.Services),
                    r.Count > 0 ? r[r.Count / 2].ToString() : "",
                    r.Count.ToString()
                }));
            }
        }
        return 0;
    }
}
