// Heatlink v2 prototype case: parameters (STAT-72)
//
// All dimensions in mm. Override any of these on the command line, e.g.
//   openscad -D 'relay_pcb=[50,26]' -D 'switch_hole_d=6.2' ...
// (make.sh passes "$@" through to every render.)
//
// Coordinate system: interior front-left corner of the base, at the
// underside of the floor, is the origin. X runs along the case (USB end on
// the left), Y runs from the low-voltage side (front) to the mains side
// (back), Z is up.

/* [Part] */
part = "assembly"; // [base, lid, assembly, section, check, rib_overlap]
explode = 15;      // assembly view: lid lift above the base (0 = closed)

/* [Shell] */
wall          = 2.5;   // side wall thickness (>= 2.5)
floor_t       = 2.5;   // base floor thickness
lid_t         = 3.0;   // lid plate thickness
corner_r      = 4.0;   // outer corner radius (plan view)
headroom      = 20;    // clear height above the breadboard top to the lid underside

/* [Breadboard (half-size)] */
bb            = [82.5, 54.5, 8.5]; // length, width, height
bb_clr        = 0.4;   // clearance per side in the pocket
bb_rim_t      = 1.6;   // pocket retaining rim thickness
bb_rim_h      = 4.0;   // pocket retaining rim height above the floor
usb_gap       = 9.0;   // gap between the USB-end wall and the rim (holds a corner boss)
front_gap     = 1.0;   // gap between the front wall and the rim
switch_bay    = 34;    // length of the low-voltage switch bay beyond the breadboard

/* [ESP32-S3-DevKitC-1] */
devkit        = [69, 25.4]; // PCB length, width
devkit_x_off  = -2.0;  // USB edge of the DevKitC relative to the breadboard's USB end (negative = overhangs)
usb_z_above_bb = 5.7;  // USB-C receptacle centre height above the breadboard top
usb_slot      = [26, 9]; // USB cable slot in the wall (width covers both USB-C ports), height
led_from_usb  = 13;    // RGB LED (GPIO48) distance from the DevKitC's USB edge   ** measure **
led_dy        = 0;     // RGB LED offset across the board from its centre line  ** measure **
led_hole_d    = 3.2;   // light-pipe / window hole in the lid
led_cbore     = [5.2, 1.0]; // light-pipe flange counterbore in the top face (dia, depth); [0,0] = none

/* [Relay module (mains compartment)] */
relay_pcb     = [50, 26];     // module PCB, length (header -> terminals), width  ** measure **
relay_holes   = [45, 20.5];   // M3 hole spacing                                   ** measure **
relay_h       = 19;    // tallest part above the PCB (relay can / terminals)
relay_standoff = 5;    // standoff height
relay_standoff_d = 6.5;
relay_screw_d = 2.6;   // self-tap hole for M3 (or M2.5 machine screws)
relay_pcb_t   = 1.6;
mains_side_clr = 6;    // clearance between the module and the compartment walls (Y)
barrier_t     = 2.4;   // barrier wall thickness (>= 2)

/* [Low-voltage pass-through (barrier)] */
pass_size     = [10, 7];  // width, height of the hole for the VCC/GND/IN jumpers
pass_z        = 12;    // centre height above the floor top
pass_x_off    = 0;     // offset of its near edge from the module's header end

/* [Cable gland] */
gland_d       = 12.5;  // PG7 = 12.5; PG9 = 15.5; M16 = 16.2
gland_nut_af  = 19;    // locknut across flats (clearance check only)
gland_z       = 12.5;  // centre height above the floor top
gland_from_terminals_end = 6; // gland centre measured in from the module's terminal end (X)

/* [Lid screws / bosses] */
boss_d        = 8.0;
insert_d      = 4.0;   // M3 heat-set insert hole
insert_depth  = 5.7;
pilot         = false; // true = 2.5 mm self-tap holes instead of inserts
pilot_d       = 2.5;
screw_depth   = 9.0;   // total hole depth in the boss (M3x10 minus lid thickness, + margin)
screw_clear_d = 3.4;
screw_head    = "csk"; // [csk, cbore]
csk_d         = 6.5;   // countersink diameter (90 degree)
cbore         = [6.5, 1.6]; // counterbore dia, depth (pan/cap head)

/* [Lid fit] */
lip_h         = 3.0;   // locating lip depth
lip_t         = 1.6;
fit_clr       = 0.25;  // lip / groove clearance per side
rib_t         = 1.2;   // barrier groove ribs on the lid
rib_h         = 4.0;   // how far the ribs reach down over the barrier

/* [Switch] */
switch_type   = "rotary"; // [rotary, toggle]
switch_hole_d = 12;    // 12 for a typical rotary bushing (M10/3/8"), 6.2 for a mini toggle
switch_body_d = 26;    // clearance check only
switch_body_depth = 20;
anti_rot      = true;  // blind hole for the switch's anti-rotation tab
anti_rot_r    = 7.5;   // tab radius from the switch centre  ** measure **
anti_rot_d    = 3.2;
anti_rot_angle = 90;   // degrees, 90 = towards the mains side (back)

/* [Keyholes (wall mount)] */
kh_head_d     = 8.5;   // entry hole for the screw head
kh_slot_w     = 4.2;   // slot for the screw shank
kh_slot_len   = 9;     // centre of entry hole to end of slot
kh_lip        = 2.0;   // plastic the head hooks behind
kh_channel_h  = 3.2;   // head height allowance
kh_roof       = 1.4;   // closed roof over the head (keeps the screw out of the compartment)
kh_inset      = 16;    // keyhole distance from each end wall (X)

/* [Labels] */
font          = "Liberation Sans:style=Bold";
deboss        = 0.6;
label_size    = 4;
title_size    = 6.5;
title_text    = "nakostat heatlink";
warn_text     = "230V";

$fn = 64;
