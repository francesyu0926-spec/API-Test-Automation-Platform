function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  var apis = ["terminal.sfccn.com", "sfccn.com", "cftc.sfccn.com", "yftc.sfccn.com", "static.sfccn.com", "news.sfccn.com", "image.sfccn.com"];
  for (var i = 0; i < apis.length; i++) {
    var p = apis[i];
    if (host === p || dnsDomainIs(host, p) || shExpMatch(host, "*." + p)) {
      return "PROXY 127.0.0.1:8888";
    }
  }
  return "DIRECT";
}
