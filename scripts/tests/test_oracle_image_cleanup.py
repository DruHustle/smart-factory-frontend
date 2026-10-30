import copy
import importlib.util
import pathlib
import unittest

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
