"""Exercise the private capture fixture with real TLS and SMTP, without Docker."""

import base64
import contextlib
from email.message import EmailMessage
import importlib.util
import io
import json
from pathlib import Path
import smtplib
import socket
import ssl
import tempfile
import threading
import unittest
import urllib.error
import urllib.request


SPEC = importlib.util.spec_from_file_location(
    "smtp_capture", Path(__file__).with_name("smtp-capture.py")
)
capture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture)


def fixture_message(text="Isolated password-reset fixture.\n"):
    message = EmailMessage()
    message["From"] = capture.SENDER
    message["To"] = capture.RECIPIENT
    message["Subject"] = "Reset your Smart Factory password"
    message.set_content(text)
    return message


class SmtpCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="smtp-capture-test-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.certificate_directory = Path(cls.directory.name) / "public-ca"
        context = capture.create_tls_context(cls.certificate_directory)
        cls.client_context = ssl.create_default_context(
            cafile=str(cls.certificate_directory / "ca.pem")
        )
        cls.store = capture.MessageStore()
        cls.smtp = capture.SmtpServer(("127.0.0.1", 0), context, cls.store)
        cls.http = capture.CaptureHttpServer(("127.0.0.1", 0), cls.store)
        cls.threads = []
        for server in (cls.smtp, cls.http):
            thread = threading.Thread(
                target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
            )
            thread.start()
            cls.threads.append(thread)
        cls.addClassCleanup(cls.stop_servers)
        cls.http_url = "http://127.0.0.1:" + str(cls.http.server_port)

    @classmethod
    def stop_servers(cls):
        for server in (cls.smtp, cls.http):
            server.shutdown()
            server.server_close()
        for thread in cls.threads:
            thread.join(timeout=3)

    def setUp(self):
        self.store.clear()

    def smtp_client(self, *, encrypted=True, authenticated=True):
        client = smtplib.SMTP(*self.smtp.server_address, timeout=3)
        self.addCleanup(client.close)
        client.ehlo()
        if encrypted:
            client.starttls(context=self.client_context)
            client.ehlo()
        if authenticated:
            client.login(capture.SENDER, capture.PASSWORD)
        return client

    def request(self, path, *, method="GET", data=None):
        request = urllib.request.Request(self.http_url + path, method=method, data=data)
        return urllib.request.urlopen(request, timeout=3)

    def test_authenticated_starttls_captures_decoded_unicode_message(self):
        # The synthetic URL exercises MIME decoding without exposing real tokens.
        body = "Reset Andr\u00e9's password:\nhttp://127.0.0.1:3110/reset-password?token=synthetic-test-token\n"
        client = self.smtp_client()
        client.send_message(fixture_message(body))
        with self.request("/messages") as response:
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            messages = json.load(response)
        self.assertEqual(len(messages), 1)
        self.assertIsInstance(messages[0]["id"], int)
        self.assertEqual(messages[0]["from"], capture.SENDER)
        self.assertEqual(messages[0]["to"], [capture.RECIPIENT])
        self.assertEqual(messages[0]["subject"], "Reset your Smart Factory password")
        self.assertEqual(messages[0]["text"].replace("\r\n", "\n"), body)

    def test_auth_login_as_used_by_dotnet_is_supported(self):
        client = self.smtp_client(authenticated=False)
        self.assertEqual(client.docmd("AUTH", "LOGIN")[0], 334)
        self.assertEqual(
            client.docmd(base64.b64encode(capture.SENDER.encode()).decode())[0], 334
        )
        self.assertEqual(
            client.docmd(base64.b64encode(capture.PASSWORD.encode()).decode())[0], 235
        )
        client.send_message(fixture_message())
        self.assertEqual(len(self.store.messages()), 1)

    def test_cleartext_auth_and_envelope_are_rejected(self):
        client = self.smtp_client(encrypted=False, authenticated=False)
        self.assertFalse(client.has_extn("auth"))
        self.assertEqual(client.docmd("AUTH", "LOGIN")[0], 530)
        self.assertEqual(client.mail(capture.SENDER)[0], 530)
        self.assertEqual(client.rcpt(capture.RECIPIENT)[0], 503)
        self.assertEqual(self.store.messages(), [])

    def test_tls_without_authentication_is_rejected(self):
        client = self.smtp_client(authenticated=False)
        self.assertEqual(client.mail(capture.SENDER)[0], 530)
        self.assertEqual(self.store.messages(), [])

    def test_wrong_password_is_rejected(self):
        client = self.smtp_client(authenticated=False)
        payload = base64.b64encode(b"\0" + capture.SENDER.encode() + b"\0wrong-password")
        self.assertEqual(client.docmd("AUTH", "PLAIN " + payload.decode())[0], 535)
        self.assertEqual(self.store.messages(), [])

    def test_untrusted_tls_certificate_is_rejected(self):
        client = self.smtp_client(encrypted=False, authenticated=False)
        with self.assertRaises(ssl.SSLCertVerificationError):
            client.starttls(context=ssl.create_default_context())
        self.assertEqual(self.store.messages(), [])

    def test_certificate_verifies_for_the_compose_service_hostname(self):
        with socket.create_connection(self.smtp.server_address, timeout=3) as connection:
            reader = connection.makefile("rb")
            try:
                self.assertTrue(reader.readline().startswith(b"220 "))
                connection.sendall(b"EHLO fixture\r\n")
                while reader.readline()[3:4] == b"-":
                    pass
                connection.sendall(b"STARTTLS\r\n")
                self.assertTrue(reader.readline().startswith(b"220 "))
            finally:
                reader.close()
            with self.client_context.wrap_socket(connection, server_hostname="mail-capture") as secured:
                secured.sendall(b"QUIT\r\n")
                self.assertTrue(secured.recv(512).startswith(b"221 "))

    def test_other_senders_and_recipients_cannot_be_relayed(self):
        client = self.smtp_client()
        self.assertEqual(client.mail("other@example.test")[0], 553)
        self.assertEqual(client.mail(capture.SENDER)[0], 250)
        self.assertEqual(client.rcpt("someone@example.test")[0], 550)
        self.assertEqual(client.docmd("DATA")[0], 503)
        self.assertEqual(self.store.messages(), [])

    def test_oversized_mail_and_smtp_lines_are_rejected(self):
        client = self.smtp_client()
        self.assertEqual(
            client.mail(capture.SENDER, ["SIZE=" + str(capture.MAX_MESSAGE_BYTES + 1)])[0],
            552,
        )
        with socket.create_connection(self.smtp.server_address, timeout=3) as connection:
            reader = connection.makefile("rb")
            try:
                self.assertTrue(reader.readline().startswith(b"220 "))
                connection.sendall(b"X" * (capture.MAX_LINE_BYTES + 1) + b"\r\n")
                self.assertEqual(reader.readline(), b"")
            finally:
                reader.close()
        self.assertEqual(self.store.messages(), [])

    def test_data_size_limit_is_enforced_even_without_size_extension(self):
        client = self.smtp_client()
        self.assertEqual(client.mail(capture.SENDER)[0], 250)
        self.assertEqual(client.rcpt(capture.RECIPIENT)[0], 250)
        code, _ = client.data("Content-Type: text/plain\r\n\r\n" + ("x" * 998 + "\r\n") * 18)
        self.assertEqual(code, 552)
        self.assertEqual(self.store.messages(), [])

    def test_http_health_clear_and_unknown_path_contract(self):
        with self.request("/health") as response:
            self.assertEqual(json.load(response), {"ok": True})
        self.store.add(capture.SENDER, [capture.RECIPIENT], fixture_message().as_bytes())
        with self.request("/clear", method="POST", data=b"") as response:
            self.assertEqual(json.load(response), {"cleared": True})
        self.assertEqual(self.store.messages(), [])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/unknown")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request("/clear", method="POST", data=b"not-empty")
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_public_certificate_volume_never_contains_a_private_key(self):
        self.assertEqual(
            [path.name for path in self.certificate_directory.iterdir()], ["ca.pem"]
        )
        public_certificate = (self.certificate_directory / "ca.pem").read_text()
        self.assertIn("BEGIN CERTIFICATE", public_certificate)
        self.assertNotIn("PRIVATE KEY", public_certificate)
        self.assertEqual((self.certificate_directory / "ca.pem").stat().st_mode & 0o777, 0o644)

    def test_smtp_and_http_do_not_log_message_or_authentication_content(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            client = self.smtp_client()
            client.send_message(fixture_message("private-synthetic-reset-link\n"))
            with self.request("/messages") as response:
                json.load(response)
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request("/private-synthetic-reset-link")
            error.exception.close()
            client.quit()
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")


class MessageStoreTests(unittest.TestCase):
    def test_only_latest_bounded_messages_are_retained(self):
        store = capture.MessageStore()
        for index in range(capture.MAX_MESSAGES + 2):
            store.add(capture.SENDER, [capture.RECIPIENT], fixture_message(str(index)).as_bytes())
        messages = store.messages()
        self.assertEqual(len(messages), capture.MAX_MESSAGES)
        self.assertEqual(messages[0]["text"].strip(), "2")
        self.assertEqual(messages[-1]["id"], capture.MAX_MESSAGES + 2)
        messages[0]["to"].append("other@example.test")
        self.assertEqual(store.messages()[0]["to"], [capture.RECIPIENT])

    def test_oversized_and_non_text_messages_are_rejected(self):
        store = capture.MessageStore()
        with self.assertRaises(ValueError):
            store.add(capture.SENDER, [capture.RECIPIENT], b"x" * (capture.MAX_MESSAGE_BYTES + 1))
        with self.assertRaises(ValueError):
            store.add(capture.SENDER, [capture.RECIPIENT], b"Content-Type: text/html\r\n\r\n<b>test</b>")
        self.assertEqual(store.messages(), [])


if __name__ == "__main__":
    unittest.main()
