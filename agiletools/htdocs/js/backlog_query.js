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

    var formToken = $("#query input[name='__FORM_TOKEN']").val(),
        $tables = $("table", "#query-results"),
        $handlePrototype = $("<td class='rearrange-handle'></td>"),
        $allHandles = $(),
        helpTooltip = true;

    // Add handles to head and body
    $("thead tr", $tables).prepend("<th class='rearrange-handle'></th>");
    $("tbody tr", $tables).each(function() {
      var $handle = $handlePrototype.clone().prependTo(this);
      $allHandles = $allHandles.add($handle);
    });

    // Do some magic to make sure the table rows don't appear to change width
    // when being sorted. Also, show a tooltip, but remove it after the first click
    $allHandles.tooltip({
      title: "Reorder ticket",
      placement: "right",
      container: "body"
    });

    $allHandles.on("mousedown", function() {
      $("td", $(this).parent()).each(function() {
        $(this).width($(this).width());
      });

      if(helpTooltip) {
        $allHandles.tooltip("destroy");
        helpTooltip = false;
      }
    });

    // Make the tables sortable
    $("tbody", $tables).sortable({
      containment: "parent",
      handle: ".rearrange-handle",
      start: function(e, ui) {
        // Remember the last position so we don't try to save if unmoved
        ui.item.data("old_index", $("tr", this).index(ui.item));
      },
      stop: function(e, ui) {
        var relativeDirection, $relative;

        // Remove our assigned widths (from above) once we've finished sorting
        $("td", ui.item).each(function() {
          $(this).removeAttr("style");
        });

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