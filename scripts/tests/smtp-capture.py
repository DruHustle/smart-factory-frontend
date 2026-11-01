#!/usr/bin/env python3
"""Private, bounded SMTP capture for the disposable bundle acceptance test.

This is not a mail relay. It accepts only its synthetic authenticated sender and
one synthetic recipient after STARTTLS. Messages stay in bounded memory. The
loopback-only HTTP endpoint is read through `docker compose exec`, never exposed
to the host. No request, message, password, reset link or exception body is logged.
"""

import argparse
import base64
from collections import deque
import email.policy
from email.parser import BytesParser
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import pwd
import re
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading


SENDER = "mail-capture@example.test"
RECIPIENT = "viewer@example.com"
PASSWORD = "isolated-mail-capture-password"
MAX_MESSAGE_BYTES = 16 * 1024
MAX_MESSAGES = 8
MAX_LINE_BYTES = 2048
MAX_CONNECTIONS = 8


def create_tls_context(cert_directory):
    """Publish only the public CA; all private keys are deleted before serving."""
    destination = Path(cert_directory)
    destination.mkdir(mode=0o755, parents=True, exist_ok=True)
    if any(item.name != "ca.pem" for item in destination.iterdir()):
        raise ValueError("Unexpected fixture certificate files")
    with tempfile.TemporaryDirectory(prefix="smtp-capture-keys-") as temporary:
        folder = Path(temporary)
        ca_key, ca_cert = folder / "ca.key", folder / "ca.pem"
        server_key, server_csr, server_cert = folder / "server.key", folder / "server.csr", folder / "server.pem"
        extension = folder / "server.ext"
        extension.write_text(
            "basicConstraints=critical,CA:FALSE\n"
            "keyUsage=critical,digitalSignature,keyEncipherment\n"
            "extendedKeyUsage=serverAuth\n"
            "subjectAltName=DNS:mail-capture,DNS:localhost,IP:127.0.0.1\n",
            encoding="ascii",
        )
        commands = [
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2",
             "-keyout", str(ca_key), "-out", str(ca_cert), "-subj", "/CN=Smart Factory isolated SMTP test CA",
             "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"],
            ["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", str(server_key),
             "-out", str(server_csr), "-subj", "/CN=mail-capture"],
            ["openssl", "x509", "-req", "-in", str(server_csr), "-CA", str(ca_cert), "-CAkey", str(ca_key),
             "-CAcreateserial", "-out", str(server_cert), "-days", "2", "-sha256", "-extfile", str(extension)],
        ]
        for command in commands:
            subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(server_cert, server_key)
        # The volume is private to this disposable project and contains one
        # public certificate, never its key or any application credential.
        output = destination / "ca.pem"
        output.write_bytes(ca_cert.read_bytes())
        output.chmod(0o644)
    return context


class MessageStore:
    def __init__(self):
        self._messages = deque(maxlen=MAX_MESSAGES)
        self._lock = threading.Lock()
        self._next_id = 1

    def add(self, sender, recipients, raw):
        if len(raw) > MAX_MESSAGE_BYTES:
            raise ValueError("Message too large")
        message = BytesParser(policy=email.policy.default).parsebytes(raw)
        if message.is_multipart() or message.get_content_type() != "text/plain":
            raise ValueError("Only a plain text fixture message is supported")
        body = message.get_payload(decode=True) or b""
        if len(body) > MAX_MESSAGE_BYTES:
            raise ValueError("Decoded message too large")
        text = body.decode(message.get_content_charset() or "ascii", errors="strict")
        with self._lock:
            self._messages.append({
                "id": self._next_id, "from": sender, "to": list(recipients),
                "subject": str(message.get("Subject", ""))[:256], "text": text,
            })
            self._next_id += 1

    def messages(self):
        with self._lock:
            return [dict(message, to=list(message["to"])) for message in self._messages]

    def clear(self):
        with self._lock:
            self._messages.clear()


class SmtpHandler(socketserver.BaseRequestHandler):
    def reply(self, line):
        self.connection.sendall(line.encode("ascii") + b"\r\n")

    def line(self):
        value = self.reader.readline(MAX_LINE_BYTES + 1)
        if not value or len(value) > MAX_LINE_BYTES or not value.endswith(b"\r\n"):
            raise ValueError("Invalid SMTP line")
        return value[:-2]

    def credentials(self, value):
        if len(value) > 512:
            raise ValueError("Invalid credential input")
        return base64.b64decode(value, validate=True)

    def authenticate(self, argument):
        mechanism, _, initial = argument.partition(b" ")
        if mechanism.upper() == b"PLAIN":
            if not initial:
                self.reply("334 ")
                initial = self.line()
            fields = self.credentials(initial).split(b"\0")
            if len(fields) != 3:
                return False
            identity, username, password = fields
            return identity in (b"", SENDER.encode()) and hmac.compare_digest(username, SENDER.encode()) and hmac.compare_digest(password, PASSWORD.encode())
        if mechanism.upper() == b"LOGIN":
            if not initial:
                self.reply("334 VXNlcm5hbWU6")
                initial = self.line()
            username = self.credentials(initial)
            self.reply("334 UGFzc3dvcmQ6")
            password = self.credentials(self.line())
            return hmac.compare_digest(username, SENDER.encode()) and hmac.compare_digest(password, PASSWORD.encode())
        return False

    def handle(self):
        self.connection = self.request
        self.connection.settimeout(10)
        self.reader = self.connection.makefile("rb")
        encrypted = authenticated = greeted = False
        sender, recipients = None, []
        try:
            self.reply("220 mail-capture ESMTP isolated test fixture")
            for _ in range(64):
                command, _, argument = self.line().partition(b" ")
                command = command.upper()
                if command in (b"EHLO", b"HELO"):
                    greeted = True
                    sender, recipients = None, []
                    self.reply("250-mail-capture")
                    self.reply("250-AUTH LOGIN PLAIN" if encrypted else "250-STARTTLS")
                    self.reply("250 SIZE " + str(MAX_MESSAGE_BYTES))
                elif command == b"STARTTLS":
                    if encrypted or not greeted:
                        self.reply("503 Invalid SMTP sequence")
                        continue
                    self.reply("220 Begin TLS")
                    self.reader.close()
                    self.connection = self.server.tls_context.wrap_socket(self.connection, server_side=True)
                    self.connection.settimeout(10)
                    self.reader = self.connection.makefile("rb")
                    encrypted, authenticated, greeted = True, False, False
                    sender, recipients = None, []
                elif command == b"AUTH":
                    if not encrypted:
                        self.reply("530 STARTTLS required")
                    elif not greeted or authenticated:
                        self.reply("503 Invalid SMTP sequence")
                    elif self.authenticate(argument):
                        authenticated = True
                        self.reply("235 Authentication successful")
                    else:
                        self.reply("535 Authentication rejected")
                        return
                elif command == b"MAIL":
                    if not encrypted or not authenticated or not greeted:
                        self.reply("530 TLS and authentication required")
                        continue
                    match = re.fullmatch(rb"FROM:\s*<([^<>]{1,320})>(?:\s+SIZE=(\d{1,8}))?", argument, re.IGNORECASE)
                    if not match or match[1].lower() != SENDER.encode():
                        self.reply("553 Synthetic sender required")
                    elif match[2] and int(match[2]) > MAX_MESSAGE_BYTES:
                        self.reply("552 Message too large")
                    else:
                        sender, recipients = SENDER, []
                        self.reply("250 Sender accepted")
                elif command == b"RCPT":
                    match = re.fullmatch(rb"TO:\s*<([^<>]{1,320})>", argument, re.IGNORECASE)
                    if sender is None:
                        self.reply("503 Sender required")
                    elif not match or match[1].lower() != RECIPIENT.encode():
                        self.reply("550 Only the isolated recipient is accepted")
                    else:
                        recipients = [RECIPIENT]
                        self.reply("250 Recipient accepted")
                elif command == b"DATA":
                    if sender is None or not recipients:
                        self.reply("503 Sender and recipient required")
                        continue
                    self.reply("354 End message with a single dot")
                    body = bytearray()
                    while True:
                        line = self.line()
                        if line == b".":
                            break
                        if line.startswith(b".."):
                            line = line[1:]
                        body.extend(line + b"\r\n")
                        if len(body) > MAX_MESSAGE_BYTES:
                            self.reply("552 Message too large")
                            return
                    self.server.store.add(sender, recipients, bytes(body))
                    self.reply("250 Message captured")
                    sender, recipients = None, []
                elif command == b"RSET":
                    sender, recipients = None, []
                    self.reply("250 Reset")
                elif command == b"NOOP":
                    self.reply("250 OK")
                elif command == b"QUIT":
                    self.reply("221 Closing connection")
                    return
                else:
                    self.reply("502 Unsupported command")
        except (OSError, ValueError, UnicodeError, LookupError, RecursionError):
            # Never log protocol data, reset URLs or authentication attempts.
            return
        finally:
            self.reader.close()
            self.connection.close()


class SmtpServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, context, store):
        self.tls_context, self.store = context, store
        self._slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        super().__init__(address, SmtpHandler)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def handle_error(self, request, client_address):
        pass  # No exception bodies or mail data in logs.


class CaptureHttpHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *args):
        pass

    def respond(self, status, value):
        data = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"ok": True})
        elif self.path == "/messages":
            self.respond(200, self.server.store.messages())
        else:
            self.respond(404, {"error": "not_found"})

    def do_POST(self):
        if self.path == "/clear" and self.headers.get("Content-Length", "0") == "0":
            self.server.store.clear()
            self.respond(200, {"cleared": True})
        else:
            self.close_connection = True
            self.respond(400, {"error": "invalid_request"})


class CaptureHttpServer(HTTPServer):
    def __init__(self, address, store):
        self.store = store
        super().__init__(address, CaptureHttpHandler)

    def handle_error(self, request, client_address):
        pass


def drop_root_privileges():
    if os.getuid() == 0:
        account = pwd.getpwnam("app")
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
        if os.getuid() == 0:
            raise RuntimeError("Fixture must run without root privileges")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cert-directory", default="/mail-capture-ca")
    args = parser.parse_args()
    try:
        context = create_tls_context(args.cert_directory)
        drop_root_privileges()
        store = MessageStore()
        with SmtpServer(("0.0.0.0", 2525), context, store) as smtp:
            thread = threading.Thread(target=smtp.serve_forever, daemon=True)
            thread.start()
            try:
                with CaptureHttpServer(("127.0.0.1", 8025), store) as http:
                    print("Isolated SMTP capture ready.", flush=True)
                    http.serve_forever()
            finally:
                smtp.shutdown()
                thread.join(timeout=5)
    except KeyboardInterrupt:
        return 0
    except Exception:
        print("Isolated SMTP capture failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
