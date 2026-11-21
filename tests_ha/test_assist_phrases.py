"""What Home Assistant's built-in Assist agent does with spoken list requests.

Every phrase runs through the real default conversation agent (the same path
typed or spoken Assist requests take) against real Local To-do lists. The
matrix records native behavior; it does not depend on HA Lists code.

* SUPPORTED phrases must keep working.
* GAPS describe the behavior we want but Home Assistant does not provide yet.
  They are strict expected failures: if a future Home Assistant release (or
  an HA Lists feature) starts satisfying one, the test run reports it so the
  entry can move to SUPPORTED.
* NOT_UNDERSTOOD phrases are refused today and have no agreed target yet.
  They must never change any list.
"""

from pathlib import Path
from typing import Any

import pytest
from homeassistant.components import conversation
from homeassistant.components.homeassistant.exposed_entities import (
    async_expose_entity,
)
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.intent import IntentResponseType
from homeassistant.setup import async_setup_component
from pytest_homeassistant.common import MockConfigEntry

# Synthetic lists. "Secret" exists but is not exposed to Assist.
LISTS = {
    "todo.groceries": ("Groceries", ["Milk", "Eggs"]),
    "todo.hardware_store": ("Hardware Store", []),
    "todo.house_chores": ("House Chores", []),
    "todo.secret": ("Secret", []),
}
EXPOSED = {"todo.groceries", "todo.hardware_store", "todo.house_chores"}

OPEN = "needs_action"
DONE = "completed"


def groceries(*extra: tuple[str, str], milk: str = OPEN, eggs: str | None = OPEN):
    items = [("Milk", milk)] + ([("Eggs", eggs)] if eggs else [])
    return {"todo.groceries": items + list(extra)}


SUPPORTED = [
    # Adding: list name with optional my/the and a trailing "list".
    ("add bread to groceries", groceries(("Bread", OPEN))),
    ("add bread to my groceries list", groceries(("Bread", OPEN))),
    ("add bread to the groceries list", groceries(("Bread", OPEN))),
    ("put bread on the groceries list", groceries(("Bread", OPEN))),
    ("put bread in groceries", groceries(("Bread", OPEN))),
    ("Add Bread To Groceries", groceries(("Bread", OPEN))),
    ("add paper towels to groceries", groceries(("Paper towels", OPEN))),
    ("add 2% milk to groceries", groceries(("2% milk", OPEN))),
    (
        "add nails to the hardware store list",
        {"todo.hardware_store": [("Nails", OPEN)]},
    ),
    (
        "add vacuum stairs to house chores",
        {"todo.house_chores": [("Vacuum stairs", OPEN)]},
    ),
    # Checking off and removing existing items, case-insensitively.
    ("check off milk from groceries", groceries(milk=DONE)),
    ("check milk off groceries", groceries(milk=DONE)),
    ("check off MILK from my groceries list", groceries(milk=DONE)),
    ("complete eggs on groceries", groceries(eggs=DONE)),
    ("remove eggs from groceries", groceries(eggs=None)),
    ("delete eggs from my groceries list", groceries(eggs=None)),
    # Safety: unexposed or unknown lists are never changed.
    ("add gift to secret", {}),
    ("add bread to the shopping cart list", {}),
]

GAPS = [
    (
        "add butter and bread to groceries",
        groceries(("Butter", OPEN), ("Bread", OPEN)),
        "Several items in one request are stored as one item 'Butter and bread'.",
    ),
    (
        "add butter, bread, and jam to groceries",
        groceries(("Butter", OPEN), ("Bread", OPEN), ("Jam", OPEN)),
        "Comma-separated items are stored as one item 'Butter bread and jam'.",
    ),
    (
        "add milk to groceries",
        groceries(),
        "An item that is already open on the list is added again as a duplicate.",
    ),
    (
        "add a hammer to hardware store",
        {"todo.hardware_store": [("Hammer", OPEN)]},
        "Articles are kept: the item is stored as 'A hammer'.",
    ),
    (
        "add bread to grocery",
        groceries(("Bread", OPEN)),
        "Near-miss list names (singular/plural) are not matched.",
    ),
    (
        "add bread to the grocery list",
        groceries(("Bread", OPEN)),
        "Near-miss list names (singular/plural) are not matched.",
    ),
    (
        "add vacuum stairs to chores",
        {"todo.house_chores": [("Vacuum stairs", OPEN)]},
        "Partial list names are not matched without an alias.",
    ),
    (
        "mark milk as done on groceries",
        groceries(milk=DONE),
        "Only 'check off' and 'complete' mark items done.",
    ),
    (
        "cross milk off groceries",
        groceries(milk=DONE),
        "Only 'check off' and 'complete' mark items done.",
    ),
]

# Questions should be answered from the list; native Assist has no read intent.
READ_GAPS = [
    ("what's on my groceries list", ("Milk", "Eggs")),
    ("what is on the groceries list", ("Milk", "Eggs")),
    ("how many items are on groceries", ("2",)),
]

NOT_UNDERSTOOD = [
    "add bread",  # No list named; no default-list concept yet.
    "I need bread",
    "remind me to buy bread",
    "add bread to my shopping list",  # Built-in Shopping list intent, not to-do.
]


@pytest.fixture
async def assist(hass: HomeAssistant, tmp_path: Path) -> HomeAssistant:
    """Real conversation agent and Local To-do lists with synthetic items."""
    hass.config.config_dir = str(tmp_path)
    (tmp_path / ".storage").mkdir()
    for component in ("homeassistant", "intent", "conversation", "todo"):
        assert await async_setup_component(hass, component, {})
    for entity_id, (name, items) in LISTS.items():
        entry = MockConfigEntry(
            domain="local_todo",
            data={"todo_list_name": name, "storage_key": entity_id.split(".")[1]},
        )
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        async_expose_entity(hass, "conversation", entity_id, entity_id in EXPOSED)
        for item in items:
            await hass.services.async_call(
                "todo",
                "add_item",
                {"entity_id": entity_id, "item": item},
                blocking=True,
            )
    return hass


async def snapshot(hass: HomeAssistant) -> dict[str, list[tuple[str, str]]]:
    result = await hass.services.async_call(
        "todo",
        "get_items",
        {"entity_id": list(LISTS)},
        blocking=True,
        return_response=True,
    )
    return {
        entity_id: [(item["summary"], item["status"]) for item in value["items"]]
        for entity_id, value in result.items()
    }


async def say(hass: HomeAssistant, phrase: str) -> Any:
    result = await conversation.async_converse(
        hass, phrase, None, Context(), language="en"
    )
    await hass.async_block_till_done()
    return result.response


async def assert_changes(
    hass: HomeAssistant, phrase: str, changes: dict[str, list[tuple[str, str]]]
) -> None:
    before = await snapshot(hass)
    await say(hass, phrase)
    assert await snapshot(hass) == {**before, **changes}


@pytest.mark.parametrize(
    ("phrase", "changes"), SUPPORTED, ids=[c[0] for c in SUPPORTED]
)
async def test_supported_phrases(
    assist: HomeAssistant, phrase: str, changes: dict[str, list[tuple[str, str]]]
) -> None:
    await assert_changes(assist, phrase, changes)


@pytest.mark.parametrize(
    ("phrase", "changes"),
    [
        pytest.param(phrase, changes, marks=pytest.mark.xfail(strict=True, reason=why))
        for phrase, changes, why in GAPS
    ],
    ids=[gap[0] for gap in GAPS],
)
async def test_known_gaps(
    assist: HomeAssistant, phrase: str, changes: dict[str, list[tuple[str, str]]]
) -> None:
    await assert_changes(assist, phrase, changes)


@pytest.mark.xfail(strict=True, reason="Native Assist cannot read a to-do list back.")
@pytest.mark.parametrize(
    ("phrase", "expected"), READ_GAPS, ids=[c[0] for c in READ_GAPS]
)
async def test_reading_a_list_back(
    assist: HomeAssistant, phrase: str, expected: tuple[str, ...]
) -> None:
    before = await snapshot(assist)
    response = await say(assist, phrase)
    assert await snapshot(assist) == before
    assert response.response_type == IntentResponseType.QUERY_ANSWER
    speech = response.speech["plain"]["speech"]
    assert all(word in speech for word in expected), speech


@pytest.mark.parametrize("phrase", NOT_UNDERSTOOD)
async def test_unrecognized_requests_change_nothing(
    assist: HomeAssistant, phrase: str
) -> None:
    before = await snapshot(assist)
    response = await say(assist, phrase)
    assert response.response_type == IntentResponseType.ERROR
    assert await snapshot(assist) == before


async def test_unexposed_list_is_refused_by_name(assist: HomeAssistant) -> None:
    response = await say(assist, "add gift to the secret list")
    assert response.response_type == IntentResponseType.ERROR
    assert "not exposed" in response.speech["plain"]["speech"]


async def test_list_aliases_are_understood(assist: HomeAssistant) -> None:
    """Native entity aliases fill the partial-name gap ("chores", "to do")."""
    er.async_get(assist).async_update_entity(
        "todo.house_chores", aliases={"chores", "to do"}
    )
    await assert_changes(
        assist,
        "add dusting to chores",
        {"todo.house_chores": [("Dusting", OPEN)]},
    )
    await assert_changes(
        assist,
        "add sweeping to my to do list",
        {"todo.house_chores": [("Dusting", OPEN), ("Sweeping", OPEN)]},
    )


async def test_list_named_with_list_suffix(hass: HomeAssistant, tmp_path: Path) -> None:
    """A list called "Grocery List" (common default) works with or without "list"."""
    hass.config.config_dir = str(tmp_path)
    (tmp_path / ".storage").mkdir()
    for component in ("homeassistant", "intent", "conversation", "todo"):
        assert await async_setup_component(hass, component, {})
    entry = MockConfigEntry(
        domain="local_todo",
        data={"todo_list_name": "Grocery List", "storage_key": "grocery_list"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    async_expose_entity(hass, "conversation", "todo.grocery_list", True)
    for phrase in (
        "add milk to my grocery list",
        "add eggs to the grocery list",
        "add bread to grocery list",
    ):
        assert (await say(hass, phrase)).response_type == IntentResponseType.ACTION_DONE
    result = await hass.services.async_call(
        "todo",
        "get_items",
        {"entity_id": "todo.grocery_list"},
        blocking=True,
        return_response=True,
    )
    summaries = [item["summary"] for item in result["todo.grocery_list"]["items"]]
    assert summaries == ["Milk", "Eggs", "Bread"]
