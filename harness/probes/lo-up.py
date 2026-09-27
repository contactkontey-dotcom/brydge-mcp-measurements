"""
Bring the loopback interface up inside a fresh network namespace.

`unshare -n` gives a namespace whose only interface, `lo`, starts DOWN. There
is no `ip` binary to rely on, so this sets the IFF_UP flag directly with an
ioctl — the one thing the DNS stub and the catch-all servers need before they
can bind to 127.0.0.1.
"""
import fcntl
import socket
import struct

SIOCGIFFLAGS = 0x8913
SIOCSIFFLAGS = 0x8914
IFF_UP = 0x1

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
flags = struct.unpack("16sH", fcntl.ioctl(sock, SIOCGIFFLAGS, struct.pack("16sH", b"lo", 0)))[1]
fcntl.ioctl(sock, SIOCSIFFLAGS, struct.pack("16sH", b"lo", flags | IFF_UP))
