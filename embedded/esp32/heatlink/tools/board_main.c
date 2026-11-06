// hl-board: the board table (port/board.c) from the command line.
//
//   hl-board [name]   prints "name relay active_low|active_high sw_on sw_off led" for the board, or
//                     "unknown"; no name (or "") is the default board
//   hl-board --all    prints that line for every known board
#include <stdio.h>
#include <string.h>

#include "board.h"

static void show(const hl_board *b)
{
    if (b == NULL)
    {
        puts("unknown");
        return;
    }
    printf("%s %d %s %d %d %d\n", b->name, b->relay, b->relay_active_low ? "active_low" : "active_high",
           b->sw_on, b->sw_off, b->led);
}

int main(int argc, char *argv[])
{
    if (argc == 2 && strcmp(argv[1], "--all") == 0)
    {
        for (int i = 0; hl_board_at(i) != NULL; i++)
            show(hl_board_at(i));
        return 0;
    }
    if (argc > 2)
    {
        fprintf(stderr, "usage: see the comment at the top of board_main.c\n");
        return 2;
    }
    show(hl_board_find(argc == 2 ? argv[1] : NULL));
    return 0;
}
