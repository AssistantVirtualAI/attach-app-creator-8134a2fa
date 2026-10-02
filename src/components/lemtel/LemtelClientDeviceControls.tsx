import { useCallback, useEffect, useState } from "react";
import { adminInvoke } from "@/lib/adminInvoke";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Laptop, Loader2, RefreshCw, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";

type DeviceState = "approved" | "pending" | "revoked";
type ClientDevice = {
  deviceRef: string;
  platform: "mobile" | "desktop";
  state: DeviceState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

const FN = "lemtel-client-config";
const short = (ref: string) => `${ref.slice(0, 10)}…${ref.slice(-4)}`;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "—");
const BADGE: Record<DeviceState, "default" | "secondary" | "destructive"> = { approved: "default", pending: "secondary", revoked: "destructive" };

export function LemtelClientDeviceControls({ organizationId }: { organizationId: string }) {
  const [devices, setDevices] = useState<ClientDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<ClientDevice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const res = await adminInvoke<{ devices: ClientDevice[] }>(FN, { action: "list_devices", organizationId });
    if (res.ok && Array.isArray(res.data?.devices)) setDevices(res.data!.devices);
    else { setDevices([]); setFailed(true); }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  const revoke = async () => {
    if (!target) return;
    const deviceRef = target.deviceRef;
    setBusy(deviceRef);
    setTarget(null);
    const res = await adminInvoke(FN, { action: "revoke_device", deviceRef });
    setBusy(null);
    if (res.ok) toast.success("Device revoked");
    else toast.error("Revocation failed");
    load();
  };

  const copy = async (ref: string) => {
    try { await navigator.clipboard.writeText(ref); toast.success("Device reference copied"); } catch { toast.error("Copy failed"); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Client devices</CardTitle>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Lifecycle records only. Published Mobile/Desktop apps do not consume this lifecycle yet, so revoking does not disconnect a device immediately.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading devices…</div>
        ) : failed ? (
          <p className="text-sm text-destructive">Unable to load devices.</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices registered for this client.</p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {devices.map((d) => (
              <div key={d.deviceRef} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                {d.platform === "mobile" ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                <button type="button" className="font-mono text-xs flex items-center gap-1 hover:underline" onClick={() => copy(d.deviceRef)} title="Copy device reference">
                  {short(d.deviceRef)}<Copy className="h-3 w-3" />
                </button>
                <span className="capitalize">{d.platform}</span>
                <Badge variant={BADGE[d.state]} className="capitalize">{d.state}</Badge>
                <span className="text-muted-foreground">rev {d.revision}</span>
                <span className="text-muted-foreground">Created {fmt(d.createdAt)}</span>
                <span className="text-muted-foreground">Last activity {fmt(d.lastSeenAt)}</span>
                {d.revokedAt && <span className="text-muted-foreground">Revoked {fmt(d.revokedAt)}</span>}
                {d.state !== "revoked" && (
                  <Button variant="destructive" size="sm" className="ml-auto" disabled={busy !== null} onClick={() => setTarget(d)}>
                    {busy === d.deviceRef ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-1" />}Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Device <span className="font-mono">{target?.deviceRef}</span></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Revocation blocks the future configuration lifecycle of this device.</li>
                  <li>It does not change the phone-line password, the extension, other devices or current calls.</li>
                  <li>It is irreversible in this phase.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={revoke} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
