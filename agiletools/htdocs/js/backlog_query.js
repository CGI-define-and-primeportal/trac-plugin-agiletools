/* =============================================================================
 * backlog_query.js
 * =============================================================================
 * @author Ian Clark
 * @copyright CGI 2014
 * @file A simple script, injected into Trac's query page, to enable reordering
 * tickets using a system of dragging and dropping. This adds a toggle to the
 * left of each ticket's row, which provides the drag and drop handle.
 * =============================================================================
 * @requires jQuery (> 1.7)
 * @requires jQuery UI Sortable (> 1.10)
 * @requires Bootstrap 2 tooltip
 * ========================================================================== */

(function($) { "use strict";

  $(document).ready(function() {

    // TODO: This requires a patch to query_results.html to add
    // <th class="rearrange-handle" py:if="query.order=='_dynamic'"></th> etc.
    // Maybe we should have a fallback, which adds it in JavaScript?
    // It's done in genshi instead for speed - the JavaScript was too slow
    // for when there are 100's of rows.
    
    var formToken = $("#query input[name='__FORM_TOKEN']").val(),
        $tables = $("table", "#query-results"),
        $allHandles = $("thead tr .rearrange-handle"),
        helpTooltip = true;

    // Only show tooltip on first item, to avoid too much DOM manipulation
    $allHandles.first().tooltip({
      title: "Reorder ticket",
      placement: "right",
      container: "body"
    });

    // Make the tables sortable
    $("tbody", $tables).sortable({
      containment: "parent",
      handle: ".rearrange-handle",
      items: "tr:not(.aggregationrow)",
      start: function(e, ui) {
        // Remember the last position so we don't try to save if unmoved
        ui.item.data("old_index", $("tr", this).index(ui.item));
      },
      stop: function(e, ui) {
        var relativeDirection, $relative;

        // If our ticket has changed it's position, save it
        if($("tr", this).index(ui.item) != ui.item.data("old_index")) {
          relativeDirection = "before";
          $relative = ui.item.next();

          if(!$relative.length) {
            relativeDirection = "after";
            $relative = ui.item.prev();
          }

          $.post(window.tracBaseUrl + "backlog", {
            "__FORM_TOKEN": formToken,
            "ticket": id_from_row(ui.item),
            "relative": id_from_row($relative),
            "relative_direction": relativeDirection
          });
        }
      }
    });
  });

  function id_from_row($row) {
    return $.trim($(".id a", $row).text().replace("#", ""));
  }

}(window.jQuery));
