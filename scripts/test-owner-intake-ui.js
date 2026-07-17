const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  await testIntakeLabelsAndHelperText();
  await testProductLineTerminologyAndManagerLabels();
  await testTagSelectorMarkup();
  await testListingDetailsStayHiddenUntilWorkStarts();
  await testTablecraftListingStillLoadsWithProductLine();
  await testExistingListingLoadsMatchingTagCheckboxes();
  await testOwnerProductLineManagerAddsAndRemovesUnusedLine();
  await testOwnerProductLineManagerBlocksUsedLineRemoval();
  await testSeriesFieldRemainsIndependentFromProductLineManager();
  await testTagManagerAddsGroupAndTag();
  await testTagManagerRemovesUnusedTag();
  await testTagManagerBlocksUsedTagRemoval();
  await testBackToListingsLeavesUnchangedExistingListing();
  await testBackToListingsConfirmsEditedExistingListing();
  await testGeneratedJsonToggle();
  await testAssetChecklistToggle();
  await testIntakeModeSpecificLabels();
  await testExistingListingDraftRestoresAfterReload();
  await testExistingListingPublishPreservesUnknownTags();
  await testExistingListingReopenRestoresSavedTagCheckboxes();
  await testExistingListingPublishOmitsUndefinedSeriesFields();
  await testExistingListingSuccessfulUpdateReturnsToPicker();
  await testIntakeReviewAndDiscardConfirmation();
  await testNonJsonPublishErrorsShowHttpDetails();
  console.log("Owner intake UI tests passed.");
}

async function testIntakeLabelsAndHelperText() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  assert.match(html, /Creating New Product/, "Product intake should show a clear new-product mode indicator.");
  assert.match(html, />New Listing</, "Product intake should expose a New Listing launcher.");
  assert.match(html, />Check New Listing</, "Product intake should expose a Check New Listing action.");
  assert.match(html, />Review New Product</, "Product intake should expose a Review New Product action.");
  assert.match(html, />Publish New Product</, "Product intake should expose a Publish New Product action.");
  assert.match(html, />Clear New Product Form</, "Product intake should expose a Clear New Product Form action.");
  assert.match(html, /Checks the form for missing or invalid information and refreshes advisory suggestions\. Does not save changes\./, "Product intake should explain the check action.");
  assert.match(html, /Shows the generated product data and file plan so you can confirm exactly what will be published\./, "Product intake should explain the review action.");
  assert.match(html, /Discards unsaved work from this form only\. Published data is not affected\./, "Product intake should explain the discard action.");
  assert.match(html, /aria-describedby="intake-check-help"/, "Product intake actions should expose accessible helper text.");
  assert.doesNotMatch(html, /Analyze Listing|Publish Product|Reset Form/, "Product intake should not keep the vague old action labels.");
}

async function testProductLineTerminologyAndManagerLabels() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  assert.match(html, /<label for="product-line">Product Line<\/label>/, "The productLine field should be labeled Product Line again.");
  assert.match(html, /<label for="product-series">Series<\/label>/, "The series field should be labeled Series again.");
  assert.match(html, />Manage Product Lines</, "The owner intake should expose a Manage Product Lines control.");
  assert.match(html, />Product Line Fit</, "Advisor copy should use Product Line terminology in the owner intake.");
  assert.doesNotMatch(html, /<label for="product-line">Store Line<\/label>/, "The old Store Line label should be removed.");
}

async function testTagSelectorMarkup() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "assets", "js", "product-intake.js"), "utf8");
  assert.match(html, />Manage Tags</, "The owner intake should expose a Manage Tags control.");
  assert.match(html, /id="product-tag-selector"/, "The owner intake should render a grouped tag selector.");
  assert.match(script, /Product Lines[\s\S]*Genre[\s\S]*Product Type[\s\S]*Game System/, "The grouped tag selector should include the default tag groups.");
  assert.match(html, /<input id="product-tags" type="hidden"/, "The legacy tags field should remain as a hidden publish field.");
  assert.doesNotMatch(html, /<input id="product-tags" class="dock-input" type="text"/, "The old visible free-text tags input should be removed from normal use.");
}

async function testTablecraftListingStillLoadsWithProductLine() {
  const harness = createHarness();
  await harness.flush();

  assert.ok(getSelectOptionLabels(harness.fields.line).includes("Tablecraft"), "Tablecraft should stay available in the Product Line selector.");

  harness.fields.existingSelect.value = "tablecraft-primer";
  harness.buttons.loadExisting.click();

  assert.equal(harness.fields.line.value, "Tablecraft", "Loading an existing Tablecraft listing should preserve productLine.");
  assert.equal(harness.fields.series.value, "Tablecraft", "Loading an existing Tablecraft listing should preserve series separately.");
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Tablecraft Primer", "Tablecraft listings should still load into existing-listing mode.");
  assert.equal(harness.fields.title.value, "Tablecraft Primer", "The existing Tablecraft listing should still populate the form.");
}

async function testExistingListingLoadsMatchingTagCheckboxes() {
  const harness = createHarness();
  await harness.flush();

  assert.ok(findTagCheckbox(harness, "Nippon Folio"), "Nippon Folio should be available as a Product Lines tag checkbox.");

  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  assert.equal(findTagCheckbox(harness, "Fantasy")?.checked, true, "Existing known tags should load as checked checkboxes.");
  assert.equal(findTagCheckbox(harness, "Historical")?.checked, false, "Unselected known tags should stay unchecked.");
  assert.match(harness.outputs.tagPreservedNote.textContent, /Preview/, "Unknown existing tags should be called out as preserved.");
  assert.equal(harness.fields.tags.value, "Fantasy, Preview", "The hidden tags field should preserve the combined visible and unknown tag values.");
}

async function testOwnerProductLineManagerAddsAndRemovesUnusedLine() {
  const harness = createHarness();
  await harness.flush();

  harness.buttons.manageProductLines.click();
  assert.equal(harness.outputs.productLineManagerPanel.hidden, false, "Manage Product Lines should reveal the management panel.");

  harness.fields.productLineManagerInput.value = "Night Roads";
  harness.buttons.addProductLine.click();

  assert.ok(getSelectOptionLabels(harness.fields.line).includes("Night Roads"), "Adding a product line should make it immediately selectable in Product Line.");
  assert.match(harness.outputs.productLineManagerStatus.textContent, /Night Roads added/i, "Adding a product line should confirm success.");

  harness.fields.line.value = "Night Roads";
  harness.fields.line.dispatch("change");
  assert.equal(harness.fields.line.value, "Night Roads", "A newly added product line should be selectable immediately.");

  const addedRow = findProductLineManagerRow(harness, "Night Roads");
  assert.ok(addedRow, "The manager list should render the newly added product line.");
  getProductLineRemoveButton(addedRow).click();

  assert.ok(!getSelectOptionLabels(harness.fields.line).includes("Night Roads"), "Removing an unused product line should remove it from the Product Line selector immediately.");
  assert.match(harness.outputs.productLineManagerStatus.textContent, /Night Roads removed/i, "Removing an unused product line should explain that no published listing changed.");
}

async function testOwnerProductLineManagerBlocksUsedLineRemoval() {
  const harness = createHarness();
  await harness.flush();

  harness.buttons.manageProductLines.click();
  const tablecraftRow = findProductLineManagerRow(harness, "Tablecraft");
  assert.ok(tablecraftRow, "The manager should list the used Tablecraft product line.");

  const removeButton = getProductLineRemoveButton(tablecraftRow);
  assert.equal(removeButton.disabled, true, "Used product lines should not expose an active remove action.");
  assert.match(getProductLineNote(tablecraftRow), /Used by 1 product/i, "Used product lines should explain why they cannot be removed.");

  const removed = harness.api.removeOwnerProductLine("Tablecraft");
  assert.equal(removed, false, "Removing a used product line should be blocked even if called directly.");
  assert.match(harness.outputs.productLineManagerStatus.textContent, /cannot be removed/i, "Blocked removal should explain that products still use the line.");
}

async function testSeriesFieldRemainsIndependentFromProductLineManager() {
  const harness = createHarness();
  await harness.flush();

  harness.fields.series.value = "Chronicles";
  harness.buttons.manageProductLines.click();
  harness.fields.productLineManagerInput.value = "Night Roads";
  harness.buttons.addProductLine.click();
  assert.equal(harness.fields.series.value, "Chronicles", "Adding a Product Line should not overwrite the Series field.");

  getProductLineRemoveButton(findProductLineManagerRow(harness, "Night Roads")).click();
  assert.equal(harness.fields.series.value, "Chronicles", "Removing an unused Product Line should not alter the Series field.");
}

async function testTagManagerAddsGroupAndTag() {
  const harness = createHarness();
  await harness.flush();

  harness.buttons.manageTags.click();
  assert.equal(harness.outputs.tagManagerPanel.hidden, false, "Manage Tags should reveal the tag manager.");

  harness.fields.tagManagerGroupInput.value = "Tone";
  harness.buttons.addTagGroup.click();
  assert.ok(getSelectOptionLabels(harness.fields.tagManagerGroupSelect).includes("Tone"), "Adding a tag group should make it immediately selectable.");
  assert.match(harness.outputs.tagManagerStatus.textContent, /Tone added/i, "Adding a tag group should confirm success.");

  harness.fields.tagManagerGroupSelect.value = "Tone";
  harness.fields.tagManagerTagInput.value = "Melancholic";
  harness.buttons.addTag.click();
  assert.ok(findTagCheckbox(harness, "Melancholic"), "Adding a tag should make it immediately available in the checkbox selector.");
  assert.match(harness.outputs.tagManagerStatus.textContent, /Melancholic added/i, "Adding a tag should confirm success.");

  const tagCheckbox = findTagCheckbox(harness, "Melancholic");
  tagCheckbox.checked = true;
  tagCheckbox.dispatch("change");
  assert.ok(harness.api.getCurrentTagValues().includes("Melancholic"), "A newly added tag should be selectable immediately.");
}

async function testTagManagerRemovesUnusedTag() {
  const harness = createHarness();
  await harness.flush();

  harness.buttons.manageTags.click();
  harness.fields.tagManagerGroupInput.value = "Tone";
  harness.buttons.addTagGroup.click();
  harness.fields.tagManagerGroupSelect.value = "Tone";
  harness.fields.tagManagerTagInput.value = "Melancholic";
  harness.buttons.addTag.click();

  const groupRow = findTagManagerGroup(harness, "Tone");
  const tagRow = findTagManagerItem(groupRow, "Melancholic");
  getTagRemoveButton(tagRow).click();

  assert.equal(findTagCheckbox(harness, "Melancholic"), null, "Removing an unused tag should remove it from the checkbox selector immediately.");
  assert.match(harness.outputs.tagManagerStatus.textContent, /Melancholic removed/i, "Removing an unused tag should confirm that no published listing changed.");
}

async function testTagManagerBlocksUsedTagRemoval() {
  const harness = createHarness();
  await harness.flush();

  harness.buttons.manageTags.click();
  const productLinesGroup = findTagManagerGroup(harness, "Product Lines");
  const tablecraftRow = findTagManagerItem(productLinesGroup, "Tablecraft");
  const removeButton = getTagRemoveButton(tablecraftRow);

  assert.equal(removeButton.disabled, true, "Used tags should not expose an active remove action.");
  assert.match(getTagManagerNote(tablecraftRow), /Used by 1 product/i, "Used tags should explain why they cannot be removed.");

  const removed = harness.api.removeOwnerTag("Product Lines", "Tablecraft");
  assert.equal(removed, false, "Used tags should remain protected even if removal is called directly.");
  assert.match(harness.outputs.tagManagerStatus.textContent, /cannot be removed/i, "Blocked used-tag removal should explain that published listings still reference the tag.");
}

async function testListingDetailsStayHiddenUntilWorkStarts() {
  const harness = createHarness();
  await harness.flush();

  assert.equal(harness.outputs.listingDetails.hidden, true, "Listing details should stay hidden on first load.");

  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();
  assert.equal(harness.outputs.listingDetails.hidden, false, "Loading an existing listing should reveal the listing details workspace.");

  harness.buttons.reset.click();
  assert.equal(harness.outputs.listingDetails.hidden, true, "Returning to the picker from an existing listing should hide the listing details workspace.");

  harness.buttons.startNew.click();
  assert.equal(harness.outputs.listingDetails.hidden, false, "Starting a new listing should reveal the listing details workspace.");
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Creating New Product", "Starting a new listing should keep the intake in new-product mode.");
}

async function testBackToListingsLeavesUnchangedExistingListing() {
  const harness = createHarness();
  await harness.flush();

  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();
  assert.equal(harness.confirmMessages.length, 0, "Loading an existing listing should not prompt for confirmation.");

  harness.buttons.leaveListing.click();

  assert.equal(harness.confirmMessages.length, 0, "Leaving an unchanged existing listing should not ask for confirmation.");
  assert.equal(harness.outputs.listingDetails.hidden, true, "Leaving an unchanged existing listing should hide the workspace.");
  assert.equal(harness.fields.existingSelect.value, "", "Leaving an unchanged existing listing should clear the picker selection.");
  assert.equal(harness.fields.slug.value, "", "Leaving an unchanged existing listing should clear the loaded slug.");
  assert.match(harness.outputs.status.textContent, /Returned to the listing picker\. Published data was not changed\./, "Leaving an unchanged existing listing should explain that nothing was published.");
}

async function testBackToListingsConfirmsEditedExistingListing() {
  const harness = createHarness();
  await harness.flush();

  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();
  harness.fields.shortDescription.value = "Changed copy";
  harness.fields.shortDescription.dispatch("input");

  harness.confirmResponse = false;
  harness.buttons.leaveListing.click();
  assert.equal(harness.confirmMessages.length, 1, "Leaving an edited existing listing should ask for confirmation.");
  assert.equal(harness.outputs.listingDetails.hidden, false, "Canceling the discard should keep the workspace open.");
  assert.equal(harness.fields.slug.value, "agency", "Canceling the discard should preserve the loaded listing.");

  harness.confirmResponse = true;
  harness.buttons.leaveListing.click();
  assert.equal(harness.confirmMessages.length, 2, "Confirming the discard should prompt exactly once per leave attempt.");
  assert.equal(harness.outputs.listingDetails.hidden, true, "Confirming the discard should return to the listing picker.");
  assert.equal(harness.fields.slug.value, "", "Confirming the discard should clear the loaded listing state.");
  assert.match(harness.outputs.status.textContent, /Returned to the listing picker\. Published data was not changed\./, "Confirming the discard should explain that no published data changed.");
}

async function testIntakeModeSpecificLabels() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Agency", "Loading an existing product should switch the prominent mode indicator.");
  assert.match(harness.outputs.outputHeading.textContent, /Review Listing Changes/, "Existing-listing mode should use a review heading for updates.");
  assert.equal(harness.buttons.analyze.textContent, "Check Existing Listing", "Existing-listing mode should relabel the check action.");
  assert.equal(harness.buttons.review.textContent, "Review Listing Changes", "Existing-listing mode should relabel the review action.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Existing-listing mode should relabel the publish action.");
  assert.equal(harness.buttons.reset.textContent, "Discard Listing Changes", "Existing-listing mode should relabel the discard action.");
  assert.match(harness.outputs.editMode.textContent, /Editing existing listing: Agency/i, "Existing-listing mode should explain that the owner is updating a current listing.");
}

async function testGeneratedJsonToggle() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  assert.match(html, />View JSON</, "Product intake should expose a View JSON toggle button.");

  const harness = createHarness();
  await harness.flush();

  assert.equal(harness.outputs.jsonPanel.hidden, true, "Generated JSON should stay hidden by default.");
  assert.equal(harness.buttons.toggleJson.textContent, "View JSON", "The JSON toggle should start in the closed state.");

  harness.buttons.toggleJson.click();
  assert.equal(harness.outputs.jsonPanel.hidden, false, "Clicking View JSON should reveal the generated JSON panel.");
  assert.equal(harness.buttons.toggleJson.textContent, "Hide JSON", "The JSON toggle should change label after opening.");

  harness.buttons.toggleJson.click();
  assert.equal(harness.outputs.jsonPanel.hidden, true, "Clicking the toggle again should hide the generated JSON panel.");
  assert.equal(harness.buttons.toggleJson.textContent, "View JSON", "The JSON toggle should return to the closed label after hiding.");
}

async function testAssetChecklistToggle() {
  const html = fs.readFileSync(path.join(ROOT, "owner", "product-intake.html"), "utf8");
  assert.match(html, />View Asset Checklist</, "Product intake should expose a View Asset Checklist toggle button.");

  const harness = createHarness();
  await harness.flush();

  assert.equal(harness.outputs.checklistPanel.hidden, true, "Asset checklist should stay hidden by default.");
  assert.equal(harness.buttons.toggleChecklist.textContent, "View Asset Checklist", "The asset checklist toggle should start in the closed state.");

  harness.buttons.toggleChecklist.click();
  assert.equal(harness.outputs.checklistPanel.hidden, false, "Clicking View Asset Checklist should reveal the checklist panel.");
  assert.equal(harness.buttons.toggleChecklist.textContent, "Hide Asset Checklist", "The asset checklist toggle should change label after opening.");

  harness.buttons.toggleChecklist.click();
  assert.equal(harness.outputs.checklistPanel.hidden, true, "Clicking the toggle again should hide the checklist panel.");
  assert.equal(harness.buttons.toggleChecklist.textContent, "View Asset Checklist", "The asset checklist toggle should return to the closed label after hiding.");
}

async function testIntakeReviewAndDiscardConfirmation() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.buttons.review.click();
  assert.match(harness.outputs.status.textContent, /Review ready\./, "Review should clearly stay in a pre-publish state.");

  harness.confirmResponse = false;
  harness.buttons.reset.click();
  assert.equal(harness.confirmMessages.length, 1, "Discarding unsaved intake edits should require confirmation.");
  assert.equal(harness.fields.shortDescription.value, "Updated preview copy", "Declining discard should keep unsaved edits intact.");

  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.confirmResponse = true;
  harness.buttons.reset.click();
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Creating New Product", "Accepting discard should return the intake to new-product mode.");
  assert.equal(harness.fields.title.value, "", "Accepting discard should clear the form.");
  assert.match(harness.outputs.status.textContent, /Published data was not changed\./, "Discard confirmation should clearly state that published data was not changed.");
}

async function testExistingListingDraftRestoresAfterReload() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();

  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");
  harness.buttons.analyze.click();
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Checking an existing listing must not fall back to the new-product publish action.");
  assert.equal(harness.fields.slug.value, "ringbound", "Checking an existing listing must preserve the loaded slug.");
  const generatedBeforeReload = JSON.parse(harness.outputs.json.value);
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Ringbound", "Editing Ringbound should stay in existing-listing mode before reload.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Editing Ringbound should not offer a new-product publish action.");
  assert.equal(generatedBeforeReload.productLineSlug, "other-games-and-experiments", "Editing an existing listing should preserve the original product-line slug when the visible label is unchanged.");
  assert.equal(generatedBeforeReload.priceCents, null, "Editing an existing listing should not convert an empty regular price into zero cents.");
  assert.equal(generatedBeforeReload.salePriceCents, null, "Editing an existing listing should not convert an empty sale price into zero cents.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedBeforeReload, "series"), false, "Editing an existing listing should not invent empty series fields.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedBeforeReload, "seriesSlug"), false, "Editing an existing listing should not invent empty series slug fields.");

  const reloadedHarness = createHarness({
    sessionStorageStore: harness.sessionStorageStore
  });
  await reloadedHarness.flush();
  const generatedAfterReload = JSON.parse(reloadedHarness.outputs.json.value);

  assert.equal(reloadedHarness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Ringbound", "Reloading should restore the loaded Ringbound listing.");
  assert.equal(reloadedHarness.outputs.listingDetails.hidden, false, "Reloading a persisted existing-listing draft should reveal the listing details workspace.");
  assert.equal(reloadedHarness.buttons.publish.textContent, "Update Existing Listing", "A restored existing listing must not show the new-product publish action.");
  assert.equal(reloadedHarness.buttons.reset.textContent, "Discard Listing Changes", "A restored existing listing must keep the existing-listing discard action.");
  assert.equal(reloadedHarness.fields.title.value, "Ringbound", "Reloading should preserve the loaded title.");
  assert.equal(reloadedHarness.fields.slug.value, "ringbound", "Reloading should preserve the loaded slug.");
  assert.equal(reloadedHarness.fields.pageCount.value, "12", "Reloading should preserve the unsaved page-count edit.");
  assert.equal(findTagCheckbox(reloadedHarness, "Fantasy")?.checked, true, "Reloading should preserve the checked tag selector state.");
  assert.match(reloadedHarness.outputs.status.textContent, /Restored Ringbound for editing after the page was reloaded\./, "Reloading should explain why the existing listing remained active.");
  assert.equal(reloadedHarness.api.hasUnsavedChanges(), true, "Reloading should preserve the unsaved-changes baseline.");
  assert.equal(reloadedHarness.api.validateRequiredFields().length, 0, "Reloading should not fall back to new-product validation errors for a restored existing listing.");
  assert.equal(generatedAfterReload.productLineSlug, "other-games-and-experiments", "Reloading should preserve the original product-line slug.");
  assert.equal(generatedAfterReload.priceCents, null, "Reloading should preserve an empty regular price as null cents.");
  assert.equal(generatedAfterReload.salePriceCents, null, "Reloading should preserve an empty sale price as null cents.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedAfterReload, "series"), false, "Reloading should not invent empty series fields.");
  assert.equal(Object.prototype.hasOwnProperty.call(generatedAfterReload, "seriesSlug"), false, "Reloading should not invent empty series slug fields.");

  reloadedHarness.buttons.review.click();
  assert.match(reloadedHarness.outputs.status.textContent, /Review ready\./, "Reviewing the restored Ringbound draft should still work.");
  assert.equal(reloadedHarness.buttons.publish.textContent, "Update Existing Listing", "Reviewing the restored draft must not relabel the publish action.");
}

async function testExistingListingPublishPreservesUnknownTags() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  const fantasyCheckbox = findTagCheckbox(harness, "Fantasy");
  const historicalCheckbox = findTagCheckbox(harness, "Historical");
  fantasyCheckbox.checked = false;
  fantasyCheckbox.dispatch("change");
  historicalCheckbox.checked = true;
  historicalCheckbox.dispatch("change");

  await harness.buttons.publish.click();
  await harness.flush();

  assert.equal(harness.lastPublishFormData.get("tags"), "Historical, Preview", "Publishing should preserve unknown tags while applying the current checkbox selection.");
}

async function testExistingListingReopenRestoresSavedTagCheckboxes() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  const fantasyCheckbox = findTagCheckbox(harness, "Fantasy");
  const historicalCheckbox = findTagCheckbox(harness, "Historical");
  fantasyCheckbox.checked = false;
  fantasyCheckbox.dispatch("change");
  historicalCheckbox.checked = true;
  historicalCheckbox.dispatch("change");

  await harness.buttons.publish.click();
  await harness.flush();
  await harness.api.loadAvailableProductsForTests();
  await harness.flush();

  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();

  assert.equal(findTagCheckbox(harness, "Fantasy")?.checked, false, "Reopened listings should clear tags that were unchecked in the saved update.");
  assert.equal(findTagCheckbox(harness, "Historical")?.checked, true, "Reopened listings should restore tags that were checked in the saved update.");
  assert.match(harness.outputs.tagPreservedNote.textContent, /Preview/, "Reopened listings should still preserve unknown tags that survived the update.");
}

async function testExistingListingPublishOmitsUndefinedSeriesFields() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();
  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");

  await harness.buttons.publish.click();
  await harness.flush();

  assert.ok(harness.lastPublishFormData, "Existing-listing publish should submit FormData.");
  assert.equal(harness.lastPublishFormData.get("series"), "", "Existing-listing publish should submit an empty series field instead of the string \"undefined\".");
  assert.equal(harness.lastPublishFormData.get("seriesSlug"), "", "Existing-listing publish should submit an empty series slug instead of the string \"undefined\".");
}

async function testExistingListingSuccessfulUpdateReturnsToPicker() {
  const harness = createHarness();
  const deferred = createDeferred();
  harness.mockPublishResponse = deferred.promise;
  await harness.flush();
  harness.fields.existingSelect.value = "ringbound";
  harness.buttons.loadExisting.click();
  harness.fields.pageCount.value = "12";
  harness.fields.pageCount.dispatch("input");

  harness.buttons.publish.click();
  await harness.flush();

  assert.equal(harness.buttons.publish.textContent, "Updating...", "Existing-listing updates should show an Updating button state while the request is in flight.");
  assert.equal(harness.buttons.publish.disabled, true, "Existing-listing updates should disable the update button while the request is in flight.");
  assert.match(harness.outputs.status.textContent, /waiting for the existing-listing update workflow to finish/i, "Existing-listing updates should show an in-progress status.");

  deferred.resolve(createJsonResponse({
    message: "Files uploaded and the GitHub rebuild workflow was accepted.",
    ok: true,
    pending: true,
    runUrl: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/123"
  }, 202));
  await harness.flush();

  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Creating New Product", "A successful existing-listing update should close the editor and return to the picker state.");
  assert.equal(harness.outputs.listingDetails.hidden, true, "A successful existing-listing update should hide the listing details workspace after returning to the picker.");
  assert.equal(harness.fields.existingSelect.value, "", "A successful existing-listing update should clear the loaded listing selection.");
  assert.equal(harness.fields.title.value, "", "A successful existing-listing update should clear the form fields.");
  assert.equal(harness.fields.slug.value, "", "A successful existing-listing update should clear the loaded slug.");
  assert.equal(harness.buttons.publish.textContent, "Publish New Product", "A successful existing-listing update should restore the default publish action after returning to the picker.");
  assert.equal(harness.buttons.publish.disabled, false, "A successful existing-listing update should re-enable the publish button.");
  assert.match(harness.outputs.status.textContent, /Ringbound updated successfully\./, "A successful existing-listing update should show a clear success confirmation.");
  assert.match(harness.outputs.status.textContent, /back at the listing picker/i, "A successful existing-listing update should explain that the editor closed and returned to the picker.");
}

async function testNonJsonPublishErrorsShowHttpDetails() {
  const harness = createHarness();
  await harness.flush();
  harness.fields.existingSelect.value = "agency";
  harness.buttons.loadExisting.click();
  harness.fields.shortDescription.value = "Updated preview copy";
  harness.fields.shortDescription.dispatch("input");
  harness.mockPublishResponse = createTextResponse("<!DOCTYPE html><html><body><h1>Failure</h1><p>Origin publish failed hard.</p></body></html>", 500, {
    "content-type": "text/html; charset=utf-8"
  });

  await harness.buttons.publish.click();
  await harness.flush();

  assert.match(harness.outputs.status.textContent, /HTTP 500/, "Non-JSON publish failures should include the HTTP status.");
  assert.match(harness.outputs.status.textContent, /text\/html/, "Non-JSON publish failures should include the response content type.");
  assert.match(harness.outputs.status.textContent, /Failure Origin publish failed hard/i, "Non-JSON publish failures should include a safe body summary.");
  assert.equal(harness.outputs.modeIndicatorTitle.textContent, "Editing Existing Listing: Agency", "Failed existing-listing updates should keep the editor open.");
  assert.equal(harness.buttons.publish.textContent, "Update Existing Listing", "Failed existing-listing updates should restore the update button label.");
  assert.equal(harness.buttons.publish.disabled, false, "Failed existing-listing updates should re-enable the update button.");
}

function createHarness(options = {}) {
  class FakeHTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName || "div").toUpperCase();
      this.checked = false;
      this.children = [];
      this.className = "";
      this.dataset = {};
      this.disabled = false;
      this.files = [];
      this.hidden = false;
      this.innerHTML = "";
      this.listeners = new Map();
      this.placeholder = "";
      this.src = "";
      this.textContent = "";
      this.type = this.tagName === "TEXTAREA" ? "textarea" : "";
      this._value = "";
      Object.defineProperty(this, "value", {
        get: () => this._value,
        set: (nextValue) => {
          this._value = nextValue === null || nextValue === undefined ? "" : String(nextValue);
        }
      });
      this.value = "";
    }

    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }

    append(...children) {
      this.children.push(...children);
    }

    click() {
      const handler = this.listeners.get("click");
      if (handler) {
        handler({ currentTarget: this, preventDefault() {}, target: this });
      }
    }

    dispatch(type) {
      const handler = this.listeners.get(type);
      if (handler) {
        handler({ currentTarget: this, preventDefault() {}, target: this });
      }
    }

    replaceChildren(...children) {
      this.children = children;
    }

    setAttribute(name, value) {
      this[String(name)] = String(value);
    }
  }

  const byId = new Map();
  const allElements = [];
  const register = (id, element) => {
    element.id = id;
    byId.set(id, element);
    allElements.push(element);
    return element;
  };
  const createElement = (tagName = "div") => new FakeHTMLElement(tagName);
  const createInput = (value = "", type = "text") => {
    const element = createElement("input");
    element.type = type;
    element.value = value;
    return element;
  };
  const createFileInput = () => {
    const element = createInput("", "file");
    element.files = [];
    return element;
  };
  const createCheckbox = (checked = false) => {
    const element = createInput("", "checkbox");
    element.checked = checked;
    return element;
  };

  const document = {
    cookie: "trg_owner_csrf=test-token",
    createElement,
    getElementById(id) {
      return byId.get(id) || null;
    },
    querySelectorAll() {
      return allElements;
    }
  };
  const sessionStorageStore = options.sessionStorageStore || new Map();
  const localStorageStore = options.localStorageStore || new Map();
  const sessionStorage = {
    getItem(key) {
      return sessionStorageStore.has(key) ? sessionStorageStore.get(key) : null;
    },
    removeItem(key) {
      sessionStorageStore.delete(key);
    },
    setItem(key, value) {
      sessionStorageStore.set(key, String(value));
    }
  };
  const localStorage = {
    getItem(key) {
      return localStorageStore.has(key) ? localStorageStore.get(key) : null;
    },
    removeItem(key) {
      localStorageStore.delete(key);
    },
    setItem(key, value) {
      localStorageStore.set(key, String(value));
    }
  };

  const fields = {
    existingSelect: register("product-existing-select", createElement("select")),
    title: register("product-title", createInput("")),
    slug: register("product-slug", createInput("")),
    folder: register("product-folder", createInput("")),
    subtitle: register("product-subtitle", createInput("")),
    authors: register("product-authors", createInput("RV Sawyer")),
    publisher: register("product-publisher", createInput("Tobacco Road Games")),
    system: register("product-system", createInput("5E Compatible")),
    line: register("product-line", createElement("select")),
    series: register("product-series", createInput("")),
    productLineManagerInput: register("product-line-manager-input", createInput("")),
    tagManagerGroupInput: register("tag-manager-group-input", createInput("")),
    tagManagerGroupSelect: register("tag-manager-group-select", createElement("select")),
    tagManagerTagInput: register("tag-manager-tag-input", createInput("")),
    format: register("product-format", createInput("PDF")),
    pageCount: register("product-page-count", createInput("24", "number")),
    price: register("product-price", createInput("4.99")),
    salePrice: register("product-sale-price", createInput("")),
    currency: register("product-currency", createInput("USD")),
    saleEnabled: register("product-sale-enabled", createCheckbox(false)),
    status: register("product-status", createElement("select")),
    buyMode: register("product-buy-mode", createElement("select")),
    buyUrl: register("product-buy-url", createInput("")),
    shortDescription: register("product-short-description", createElement("textarea")),
    longDescription: register("product-long-description", createElement("textarea")),
    features: register("product-features", createElement("textarea")),
    tags: register("product-tags", createInput("", "hidden")),
    fulfillmentNote: register("product-fulfillment-note", createElement("textarea")),
    creationMethod: register("product-creation-method", createElement("textarea")),
    legalNote: register("product-legal-note", createElement("textarea")),
    version: register("product-version", createInput("1.0")),
    releaseDate: register("product-release-date", createInput("", "date")),
    lastUpdated: register("product-last-updated", createInput("", "date")),
    relatedSelect: register("product-related-select", createElement("select")),
    relatedList: register("product-related-list", createElement("div")),
    coverFile: register("product-cover-file", createFileInput()),
    previewFile: register("product-preview-file", createFileInput()),
    pdfFile: register("product-pdf-file", createFileInput())
  };
  fields.status.value = "preview-available";
  fields.buyMode.value = "preview-only";
  fields.shortDescription.value = "Original preview copy";
  fields.longDescription.value = "Long description";
  fields.features.value = "Feature one";
  fields.fulfillmentNote.value = "Manual note";
  fields.creationMethod.value = "Human-authored by RV Sawyer.";

  const outputs = {
    editMode: register("product-edit-mode", createElement("p")),
    listingDetails: register("listing-details-section", createElement("section")),
    productLineManagerList: register("product-line-manager-list", createElement("div")),
    productLineManagerPanel: register("product-line-manager-panel", createElement("div")),
    productLineManagerStatus: register("product-line-manager-status", createElement("p")),
    tagManagerList: register("tag-manager-list", createElement("div")),
    tagManagerPanel: register("tag-manager-panel", createElement("div")),
    tagManagerStatus: register("tag-manager-status", createElement("p")),
    tagPreservedNote: register("product-tag-preserved-note", createElement("p")),
    tagSelector: register("product-tag-selector", createElement("div")),
    modeIndicatorTitle: register("product-mode-indicator-title", createElement("span")),
    modeIndicatorCopy: register("product-mode-indicator-copy", createElement("span")),
    outputHeading: register("intake-output-heading", createElement("h2")),
    outputCopy: register("intake-output-copy", createElement("p")),
    status: register("intake-status", createElement("p")),
    advisorPanel: register("advisor-panel", createElement("section")),
    advisorSummaryCopy: register("advisor-summary-copy", createElement("p")),
    advisorSuggestedPrice: register("advisor-suggested-price", createElement("span")),
    advisorSuggestedSalePrice: register("advisor-suggested-sale-price", createElement("span")),
    advisorConfidence: register("advisor-confidence", createElement("span")),
    advisorProductType: register("advisor-product-type", createElement("span")),
    advisorSeriesFit: register("advisor-series-fit", createElement("span")),
    advisorAudience: register("advisor-audience", createElement("span")),
    advisorTags: register("advisor-tags-output", createElement("textarea")),
    advisorCrossSells: register("advisor-cross-sells-output", createElement("textarea")),
    advisorReasoningList: register("advisor-reasoning-list", createElement("ol")),
    advisorJson: register("advisor-json", createElement("textarea")),
    jsonPanel: register("generated-json-panel", createElement("div")),
    json: register("generated-json", createElement("textarea")),
    checklistPanel: register("asset-checklist-panel", createElement("div")),
    checklist: register("asset-checklist", createElement("pre")),
    assetFolder: register("asset-folder-output", createElement("p")),
    assetFileList: register("asset-file-list", createElement("div")),
    previewStatus: register("preview-status", createElement("span")),
    previewTitle: register("preview-title", createElement("h3")),
    previewSubtitle: register("preview-subtitle", createElement("p")),
    previewCopy: register("preview-copy", createElement("p")),
    previewCoverImage: register("preview-cover-image", createElement("img"))
  };

  const buttons = {
    analyze: register("analyze-listing-button", createElement("button")),
    addProductLine: register("add-product-line-button", createElement("button")),
    addTag: register("add-tag-button", createElement("button")),
    addTagGroup: register("add-tag-group-button", createElement("button")),
    applyAdvisor: register("apply-advisor-button", createElement("button")),
    ignoreAdvisor: register("ignore-advisor-button", createElement("button")),
    leaveListing: register("leave-listing-button", createElement("button")),
    loadExisting: register("product-existing-load", createElement("button")),
    manageProductLines: register("manage-product-lines-button", createElement("button")),
    manageTags: register("manage-tags-button", createElement("button")),
    startNew: register("start-new-listing-button", createElement("button")),
    addRelated: register("product-related-add", createElement("button")),
    publish: register("publish-button", createElement("button")),
    review: register("review-listing-button", createElement("button")),
    reset: register("reset-intake-button", createElement("button")),
    toggleJson: register("toggle-generated-json", createElement("button")),
    toggleChecklist: register("toggle-asset-checklist", createElement("button"))
  };

  register("intake-check-label", createElement("strong"));
  register("intake-check-help", createElement("p"));
  register("intake-review-label", createElement("strong"));
  register("intake-review-help", createElement("p"));
  register("intake-publish-label", createElement("strong"));
  register("intake-publish-help", createElement("p"));
  register("intake-reset-label", createElement("strong"));
  register("intake-reset-help", createElement("p"));

  const products = [
    {
      buyMode: "preview-only",
      buyUrl: "",
      coverImage: "/product-assets/agency/cover.webp",
      creationMethod: "Human-authored by RV Sawyer.",
      currency: "USD",
      features: ["Feature one"],
      fileList: ["Agency.pdf"],
      folder: "agency",
      format: ["PDF"],
      fulfillmentNote: "Manual note",
      gameSystem: "5E Compatible",
      gameSystemSlug: "5e-compatible",
      lastUpdated: "",
      legalNote: "",
      longDescription: "Long description",
      pageCount: 24,
      price: "4.99",
      previewImage: "/product-assets/agency/preview.webp",
      previewImages: [],
      productLine: "Fifth Edition Fantasy Roleplaying",
      productLineSlug: "fifth-edition-fantasy-roleplaying",
      relatedProducts: [],
      releaseDate: "",
      saleEnabled: false,
      salePrice: "",
      series: "",
      seriesSlug: "",
      shortDescription: "Original preview copy",
      slug: "agency",
      status: "preview-available",
      subtitle: "A test product",
      tags: ["Fantasy", "Preview"],
      title: "Agency",
      version: "1.0"
    },
    {
      buyMode: "preview-only",
      buyUrl: "",
      coverImage: "/product-assets/ringbound/cover.webp",
      creationMethod: "Human-authored by RV Sawyer.",
      currency: "USD",
      features: [],
      fileList: ["PDF details coming soon"],
      folder: "ringbound",
      format: ["PDF"],
      fulfillmentNote: "",
      gameSystem: "System TBD",
      gameSystemSlug: "system-tbd",
      lastUpdated: "2026-06-17",
      legalNote: "",
      longDescription: "Product summary coming soon.",
      pageCount: null,
      price: "",
      previewImage: "/product-assets/ringbound/preview.webp",
      previewImages: [],
      productLine: "Other Games & Experiments",
      productLineSlug: "other-games-and-experiments",
      relatedProducts: [],
      releaseDate: "2026-06-17",
      saleEnabled: false,
      salePrice: "",
      shortDescription: "Product summary coming soon.",
      slug: "ringbound",
      status: "preview-available",
      subtitle: "A Tobacco Road Games catalog preview",
      tags: ["Fantasy", "Preview"],
      title: "Ringbound",
      version: "2026 catalog preview"
    },
    {
      buyMode: "preview-only",
      buyUrl: "",
      coverImage: "/product-assets/tablecraft-primer/cover.webp",
      creationMethod: "Human-authored by RV Sawyer.",
      currency: "USD",
      features: ["Practical GM advice"],
      fileList: ["Tablecraft Primer.pdf"],
      folder: "tablecraft-primer",
      format: ["PDF"],
      fulfillmentNote: "",
      gameSystem: "System Neutral",
      gameSystemSlug: "system-neutral",
      lastUpdated: "2026-06-17",
      legalNote: "",
      longDescription: "System-neutral game-master advice.",
      pageCount: 32,
      price: "",
      previewImage: "/product-assets/tablecraft-primer/preview.webp",
      previewImages: [],
      productLine: "Tablecraft",
      productLineSlug: "tablecraft",
      relatedProducts: [],
      releaseDate: "2026-06-17",
      saleEnabled: false,
      salePrice: "",
      series: "Tablecraft",
      seriesSlug: "tablecraft",
      shortDescription: "A short Tablecraft guide.",
      slug: "tablecraft-primer",
      status: "preview-available",
      subtitle: "A practical guide for steadier tables",
      tags: ["Tablecraft", "GM Advice"],
      title: "Tablecraft Primer",
      version: "1.0"
    }
  ];
  const intakeMap = {
    products: [
      {
        folder: "agency",
        slug: "agency"
      },
      {
        folder: "ringbound",
        slug: "ringbound"
      },
      {
        folder: "tablecraft-primer",
        slug: "tablecraft-primer"
      }
    ]
  };

  const confirmMessages = [];
  const harness = {
    buttons,
    confirmMessages,
    confirmResponse: true,
    fields,
    flush,
    lastPublishFormData: null,
    mockPublishResponse: createJsonResponse({
      message: "Published."
    }),
    outputs,
    sessionStorageStore
  };

  const context = {
    Date,
    FormData,
    HTMLElement: FakeHTMLElement,
    JSON,
    URL: {
      createObjectURL() {
        return "blob:cover";
      },
      revokeObjectURL() {}
    },
    console,
    confirm(message) {
      confirmMessages.push(String(message));
      return harness.confirmResponse;
    },
    document,
    fetch: async (url, options = {}) => {
      if (String(url).includes("/data/products.json")) {
        return createJsonResponse(products);
      }
      if (String(url).includes("/data/product-intake-map.json")) {
        return createJsonResponse(intakeMap);
      }
      if (String(url).includes("/owner/api/publish")) {
        harness.lastPublishFormData = options.body || null;
        if (harness.lastPublishFormData && typeof harness.lastPublishFormData.get === "function") {
          const slug = String(harness.lastPublishFormData.get("slug") || "").trim();
          const tags = String(harness.lastPublishFormData.get("tags") || "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const matchingProduct = products.find((product) => product.slug === slug);
          if (matchingProduct) {
            matchingProduct.tags = tags;
          }
        }
        return harness.mockPublishResponse;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    globalThis: null,
    localStorage,
    sessionStorage,
    setTimeout,
    window: {
      location: {
        assign() {}
      },
      localStorage,
      sessionStorage,
      setTimeout
    }
  };
  context.globalThis = context;
  context.TRGProductAdvisor = {
    analyzeProductListing() {
      return {
        audience: ["GMs"],
        price_confidence: 0.8,
        product_type: "Guide",
        reasoning: ["Fixture reasoning"],
        series_fit: "",
        suggested_cross_sells: [],
        suggested_price: 4.99,
        suggested_sale_price: 2.99,
        suggested_tags: ["Test"]
      };
    }
  };

  const scriptPath = path.join(ROOT, "assets", "js", "product-intake.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  vm.runInNewContext(script, context, { filename: scriptPath });
  harness.api = context.TRGProductIntake;

  return harness;
}

function getSelectOptionLabels(selectElement) {
  return Array.isArray(selectElement.children)
    ? selectElement.children.map((child) => child.textContent)
    : [];
}

function findProductLineManagerRow(harness, name) {
  return Array.isArray(harness.outputs.productLineManagerList.children)
    ? harness.outputs.productLineManagerList.children.find((child) => {
      const copy = child.children?.[0];
      const title = copy?.children?.[0];
      return title?.textContent === name;
    }) || null
    : null;
}

function getProductLineRemoveButton(row) {
  return row.children[row.children.length - 1];
}

function getProductLineNote(row) {
  return row.children?.[0]?.children?.[1]?.textContent || "";
}

function findTagCheckbox(harness, tagName) {
  const groups = Array.isArray(harness.outputs.tagSelector.children)
    ? harness.outputs.tagSelector.children
    : [];

  for (const group of groups) {
    const optionGrid = group.children?.[1];
    const options = Array.isArray(optionGrid?.children) ? optionGrid.children : [];
    for (const option of options) {
      const checkbox = option.children?.[0] || null;
      const label = option.children?.[1]?.textContent || "";
      if (label === tagName) {
        return checkbox;
      }
    }
  }

  return null;
}

function findTagManagerGroup(harness, groupName) {
  return Array.isArray(harness.outputs.tagManagerList.children)
    ? harness.outputs.tagManagerList.children.find((child) => child.children?.[0]?.textContent === groupName) || null
    : null;
}

function findTagManagerItem(groupRow, tagName) {
  return Array.isArray(groupRow?.children)
    ? groupRow.children.find((child, index) => index > 0 && child.children?.[0]?.children?.[0]?.textContent === tagName) || null
    : null;
}

function getTagRemoveButton(row) {
  return row.children[row.children.length - 1];
}

function getTagManagerNote(row) {
  return row.children?.[0]?.children?.[1]?.textContent || "";
}

function createJsonResponse(payload, status = 200) {
  return {
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : "";
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
    ok: status >= 200 && status < 300,
    status
  };
}

function createTextResponse(payload, status = 200, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );

  return {
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name || "").toLowerCase()) || "";
      }
    },
    async text() {
      return String(payload);
    },
    ok: status >= 200 && status < 300,
    status
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
