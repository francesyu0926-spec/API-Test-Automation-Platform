function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();
  if (!host) return "DIRECT";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
  if (shExpMatch(host, "10.*") || shExpMatch(host, "192.168.*") || shExpMatch(host, "169.254.*")) return "DIRECT";
  if (shExpMatch(host, "172.1*") || shExpMatch(host, "172.2*") || shExpMatch(host, "172.3*")) return "DIRECT";
  var bypass = ["terminal.sfccn.com", "sfccn.com", "cftc.sfccn.com", "yftc.sfccn.com", "static.sfccn.com", "news.sfccn.com", "image.sfccn.com"];
  for (var i = 0; i < bypass.length; i++) {
    var p = bypass[i];
    if (host === p || dnsDomainIs(host, p) || shExpMatch(host, "*." + p)) return "DIRECT";
  }
  var proto = (url || "").substring(0, 6).toLowerCase();
  if (proto === "http:" || proto === "https") {
    return "PROXY 127.0.0.1:8888";
  }
  return "DIRECT";
}
