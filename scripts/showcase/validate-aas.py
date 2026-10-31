"""Independently verify emitted demo AAS bytes, references, units and material totals.

Install the repository-pinned aas-core3.0==1.1.2 (equipment/requirements-aas.txt),
then run: python scripts/showcase/validate-aas.py <export-aas.ts output directory>
No network or database is used by this validator.
"""
import base64
import json
import sys
from decimal import Decimal
from pathlib import Path
from aas_core3 import jsonization, verification


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def children(value):
    for key in ("submodelElements", "value", "statements", "annotations"):
        if isinstance(value.get(key), list):
            yield from (entry for entry in value[key] if isinstance(entry, dict) and "modelType" in entry)


def fields(value):
    return {entry["idShort"]: entry for entry in children(value)}


def validate(path):
    source = json.loads(path.read_text())
    environment = jsonization.environment_from_jsonable(source)
    errors = list(verification.verify(environment))
    assert not errors, "\n".join(map(str, errors))
    roots = [*source["assetAdministrationShells"], *source["submodels"], *source["conceptDescriptions"]]
    by_id = {node["id"]: node for node in roots}
    assert len(by_id) == len(roots), "Duplicate identifiable ID"
    assert len(source["assetAdministrationShells"]) == 1
    assert len(source["submodels"]) == 11
    concepts = {node["id"]: node for node in source["conceptDescriptions"]}
    blob_count = 0
    for node in walk(source):
        if node.get("type") == "ModelReference":
            keys = node["keys"]
            target = by_id[keys[0]["value"]]
            assert target["modelType"] == keys[0]["type"]
            for key in keys[1:]:
                target = fields(target)[key["value"]]
                assert target["modelType"] == key["type"]
        if "semanticId" in node:
            for key in node["semanticId"]["keys"]:
                assert key["value"] in concepts, f"Missing concept: {key['value']}"
        siblings = list(children(node))
        assert len({child["idShort"] for child in siblings}) == len(siblings), "Duplicate sibling idShort"
        if node.get("modelType") == "Property":
            assert isinstance(node["value"], str), "Normal JSON Property values must be strings"
        if node.get("modelType") == "Blob":
            text = base64.b64decode(node["value"], validate=True).decode("utf-8")
            assert "Authored demonstration data" in text and len(text) > 250
            blob_count += 1
        if node.get("modelType") == "DataSpecificationIec61360":
            if node["dataType"].endswith("_MEASURE"):
                assert node.get("unit"), "A measured concept needs a unit"
    assert blob_count == 3, "All three handover documents must be embedded"
    submodels = {node["idShort"]: node for node in source["submodels"]}
    material = fields(submodels["MaterialComposition"])
    entries = [fields(entry) for entry in children(material["Materials"])]
    assert sum(Decimal(entry["MassFraction"]["value"]) for entry in entries) == Decimal("100")
    assert sum(Decimal(entry["MaterialMass"]["value"]) for entry in entries) == Decimal(material["TotalMass"]["value"])
    carbon = fields(submodels["CarbonFootprint"])
    assert Decimal(carbon["IllustrativeCarbonFootprint"]["value"]) == Decimal(material["TotalMass"]["value"]) * Decimal(carbon["EmissionFactor"]["value"])
    assert fields(submodels["OperationalData"])["PhysicalControlEnabled"]["value"] == "false"
    assert "not been assessed" in fields(submodels["DigitalProductPassport"])["RegulatoryStatus"]["value"]
    return len(source["conceptDescriptions"])


if len(sys.argv) != 2:
    raise SystemExit("Usage: validate-aas.py <fixture directory>")
paths = sorted(Path(sys.argv[1]).glob("*.aas.json"))
assert len(paths) >= 18, "Export every supported profile and alias before validation"
concept_counts = [validate(path) for path in paths]
print(f"PASS: {len(paths)} AAS Core 3.0 environments; 11 submodels each; {min(concept_counts)}–{max(concept_counts)} concepts; all model/semantic references resolve; units, UTF-8 documents and mass/carbon totals verified")
