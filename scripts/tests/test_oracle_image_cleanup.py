import copy
import importlib.util
import io
import pathlib
import unittest
from unittest.mock import MagicMock, Mock, patch

spec = importlib.util.spec_from_file_location("image_cleanup", pathlib.Path(__file__).resolve().parents[2] / "deploy/oracle/cleanup-images.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def image(n, managed=True):
    return {"Id":"sha256:"+str(n)*64,"Architecture":"arm64","Os":"linux","Config":{"Labels": {"org.opencontainers.image.revision":"a"*40,"io.smartfactory.backend.revision":"b"*40,"io.smartfactory.edge.revision":"c"*40} if managed else {}},"RepoTags":["factory-qualified:old-"+str(n)]}
def container(identity,service, running=True, project="smart-factory-backend"):
    return {"Image":identity,"State":{"Running":running},"Config":{"Labels":{"com.docker.compose.project":project,"com.docker.compose.service":service}}}
class CleanupPlanTests(unittest.TestCase):
    def setUp(self):
        self.images=[image(i) for i in range(1,6)]+[image(6,False)]
        self.current,self.rollback=[i["Id"] for i in self.images[:2]]
        self.containers=[container(self.current,"api"),container(self.current,"worker"),container(self.images[3]["Id"],"app",project="other"),container(self.images[4]["Id"],"api",False)]
    def test_only_superseded_unreferenced_managed_images_are_candidates(self):
        before=copy.deepcopy(self.images)
        self.assertEqual([row["id"] for row in module.cleanup_plan(self.images,self.containers,self.current,self.rollback)],[self.images[2]["Id"]])
        self.assertEqual(before,self.images)
    def test_rejects_duplicate_or_missing_rollback(self):
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers,self.current,self.current)
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers,self.current,"sha256:"+"9"*64)
    def test_refuses_cleanup_with_multiple_or_wrong_worker(self):
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers+[container(self.current,"worker")],self.current,self.rollback)
        self.containers[1]["Image"]=self.rollback
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers,self.current,self.rollback)
    def test_refuses_unverified_platform_or_lineage(self):
        self.images[1]["Architecture"]="amd64"
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers,self.current,self.rollback)
        self.images[1]=image(2,False)
        with self.assertRaises(ValueError): module.cleanup_plan(self.images,self.containers,self.current,self.rollback)

    def test_release_fetch_follows_only_exact_frontend_alias(self):
        for path in ("/release.json", "/api/runtime/contract"):
            source = module.UI_ORIGIN + path
            target = module.UI_CANONICAL_ALIAS + path
            response = MagicMock(status=200)
            response.__enter__.return_value = response
            response.read.return_value = '{"source":"ok"}'
            opener = Mock()
            opener.open.side_effect = [module.urllib.error.HTTPError(source, 307, "redirect", {"Location": target}, io.BytesIO()), response]
            with patch.object(module.urllib.request, "build_opener", return_value=opener):
                self.assertEqual(module.fetch(module.UI_ORIGIN, path), {"source": "ok"})
            self.assertEqual([call.args[0] for call in opener.open.call_args_list], [source, target])
        source = module.UI_ORIGIN + "/release.json"
        target = module.UI_CANONICAL_ALIAS + "/release.json"
        for origin, code, location in ((module.UI_ORIGIN, 307, "https://example.com/release.json"),
                                       (module.UI_ORIGIN, 307, target + "?changed=1"),
                                       (module.UI_ORIGIN, 302, target),
                                       ("https://api.example.com", 307, target)):
            opener = Mock()
            opener.open.side_effect = module.urllib.error.HTTPError(origin + "/release.json", code, "redirect", {"Location": location}, io.BytesIO())
            with patch.object(module.urllib.request, "build_opener", return_value=opener):
                with self.assertRaises(module.urllib.error.HTTPError):
                    module.fetch(origin, "/release.json")
            self.assertEqual(opener.open.call_count, 1)
        opener = Mock()
        opener.open.side_effect = [module.urllib.error.HTTPError(source, 307, "redirect", {"Location": target}, io.BytesIO()),
                                   module.urllib.error.HTTPError(target, 307, "redirect", {"Location": "https://example.com"}, io.BytesIO())]
        with patch.object(module.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(module.urllib.error.HTTPError):
                module.fetch(module.UI_ORIGIN, "/release.json")
        self.assertEqual(opener.open.call_count, 2)
