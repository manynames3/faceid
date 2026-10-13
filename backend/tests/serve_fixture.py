"""Local contract-test server. Uses synthetic records and AWS fakes; never calls AWS."""
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def main():
    spec = importlib.util.spec_from_file_location("faceid_contract_fixture", Path(__file__).with_name("test_app.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = module.DeliveryAndCorrectionTests()
    fixture.setUp()
    app = module.app
    frontend = "http://127.0.0.1:5219"
    app.ALLOWED_ORIGINS = [frontend]
    event, person, photo = fixture.fixture()
    app.update_event(event["id"], {"name": "Garden reception (local fixture)"}, "user-123")
    person["name"] = "Noah Kim"
    photo["name"] = "sample-noah-garden.jpg"
    app.photos_table.items["photo-2"] = {**photo, "id": "photo-2", "name": "event-hero.jpg", "key": "second-fixture-photo"}
    app.assign_photo_guest(photo["id"], {"eventId": event["id"], "personId": person["id"]}, "user-123")
    module.fake_s3.generate_presigned_url = lambda _operation, Params, **_kwargs: (
        frontend + "/images/" + ("event-hero.jpg" if Params["Key"] == "second-fixture-photo" else "sample-noah-garden.jpg")
    )
    module.fake_rekognition.compare_faces = lambda **_kwargs: {"FaceMatches": [{"Similarity": 92}]}
    link = app.create_gallery_link(person["id"], "user-123", {"headers": {"origin": frontend}})
    info = {"galleryUrl": link["galleryUrl"], "personId": person["id"], "photoId": photo["id"], "eventId": event["id"]}

    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            parsed = urlparse(self.path)
            if parsed.path == "/fixture":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(info).encode())
                return
            size = int(self.headers.get("Content-Length", "0"))
            if size > 64 * 1024:
                self.send_error(413)
                return
            context = {"http": {"method": self.command}}
            if self.headers.get("Authorization") == "Bearer local-fixture-only":
                context["authorizer"] = {"jwt": {"claims": {"sub": "user-123"}}}
            event = {"rawPath": parsed.path, "requestContext": context,
                     "headers": {"origin": self.headers.get("Origin", frontend)},
                     "queryStringParameters": {key: values[0] for key, values in parse_qs(parsed.query).items()},
                     "body": self.rfile.read(size).decode() if size else ""}
            response = app.handler(event, None)
            self.send_response(response["statusCode"])
            for key, value in response["headers"].items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(response["body"].encode())

        do_GET = handle_request
        do_POST = handle_request
        do_PATCH = handle_request
        do_DELETE = handle_request
        do_OPTIONS = handle_request

        def log_message(self, _format, *_args):
            pass  # Capability query strings must not be written to logs.

    print("Synthetic contract fixture listening on http://127.0.0.1:5220", flush=True)
    HTTPServer(("127.0.0.1", 5220), Handler).serve_forever()


if __name__ == "__main__":
    main()
