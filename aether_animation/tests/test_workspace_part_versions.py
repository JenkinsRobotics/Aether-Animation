"""The portable container retains CAD records without interpreting geometry."""
import copy

import pytest

from aether_animation.aether_project import edit_project, new_project
from aether_animation.aether_workspace import AetherWorkspace, AetherWorkspaceError


@pytest.mark.parametrize("version", [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
def test_part_feature_version_roundtrip(version):
    workspace = new_project("Part versions")
    document = {"format": "aether-part", "formatVersion": version, "features": [
        {"id": "pad", "type": "extrude", "directionVector": [0.6, 0, 0.8],
         "secondEnd": {"endType": "blind", "distanceMillimeters": 2}}]}
    edit_project(workspace, "add_part", {"name": "Part", "document": document})
    original = copy.deepcopy(workspace.part_definitions)
    raw = workspace.to_bytes()[0]
    reopened = AetherWorkspace.from_bytes(raw)
    assert reopened.part_definitions == original
    assert reopened.to_bytes()[0] == raw


@pytest.mark.parametrize("version", [None, True, "3", 0, -1, 2.0, 22, 999])
def test_unsupported_embedded_part_version_is_not_interpreted(version):
    workspace = new_project("Part versions")
    with pytest.raises(AetherWorkspaceError, match="invalid authored Part projection"):
        edit_project(workspace, "add_part", {"name": "Part", "document": {
            "format": "aether-part", "formatVersion": version, "features": []}})
