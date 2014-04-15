$(document).ready(function() {

  var form_token = $("#query input[name='__FORM_TOKEN']").val(),
      $tables = $("table", "#query-results"),
      $handle_prototype = $("<td class='rearrange-handle'></td>"),
      $all_handles = $();

  // Add handles to head and body
  $("thead tr", $tables).prepend("<th class='rearrange-handle'></th>");
  $("tbody tr", $tables).each(function() {
    var $handle = $handle_prototype.clone().prependTo(this);
    $all_handles = $all_handles.add($handle);
  });

  // Do some magic to make sure the table rows don't appear to change width
  // when being sorted. Also, show a tooltip, but remove it after the first click
  var help_tooltip = true;

  $all_handles.tooltip({
    title: "Reorder ticket",
    placement: "right",
    container: "body"
  });

  $all_handles.on("mousedown", function() {
    $("td", $(this).parent()).each(function() {
      $(this).width($(this).width());
    });
    if(help_tooltip) {
      $all_handles.tooltip("destroy");
      help_tooltip = false;
    }
  });

  function id_from_row($row) {
    return $.trim($(".id a", $row).text().replace("#", ""));
  }

  // Make the tables sortable
  $("tbody", $tables).sortable({
    containment: "parent",
    handle: ".rearrange-handle",
    start: function(e, ui) {
      // Remember the last position so we don't try to save if unmoved
      ui.item.data("old_index", $("tr", this).index(ui.item));
    },
    stop: function(e, ui) {

      // Remove our assigned widths (from above) once we've finished sorting
      $("td", ui.item).each(function() {
        $(this).removeAttr("style");
      });

      if($("tr", this).index(ui.item) != ui.item.data("old_index")) {
        // Post this new position
        var relative_direction = "before",
            $relative = ui.item.next();

        if(!$relative.length) {
          relative_direction = "after";
          $relative = ui.item.prev();
        }

        $.post(window.tracBaseUrl + "backlog", {
          '__FORM_TOKEN': form_token,
          'ticket': id_from_row(ui.item),
          'relative': id_from_row($relative),
          'relative_direction': relative_direction
        });
      }
    }
  });

});