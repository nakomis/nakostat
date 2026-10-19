// Heatlink v2 prototype case (STAT-72)
//
// Two-part printed case for the breadboard prototype: a base holding the
// half-size breadboard + ESP32-S3-DevKitC-1 (low-voltage side) and a
// single-channel relay module behind a full-height barrier (mains side),
// and a lid carrying the mode switch and the status LED window.
//
// part = "base" | "lid" | "assembly" | "section" | "check" | "rib_overlap"
//   base/lid  : print orientation (flat side down, no supports)
//   assembly  : lid in place over the base, with ghost components
//   section   : closed case cut through the barrier pass-through
//   check     : intersection of base and lid in place; must be EMPTY
//   rib_overlap: lid ribs vs barrier; must be NON-EMPTY
//
// See README.md for parameters, measurements and assembly.

include <params.scad>

// ---------------------------------------------------------------- layout

pocket   = [bb[0] + 2*bb_clr, bb[1] + 2*bb_clr];
pocket_x0 = usb_gap + bb_rim_t;
pocket_y0 = front_gap + bb_rim_t;

lv_len   = pocket_x0 + pocket[0] + bb_rim_t + switch_bay;   // interior length
lv_dep   = pocket_y0 + pocket[1] + bb_rim_t + front_gap;    // low-voltage interior depth
mains_y0 = lv_dep + barrier_t;
mains_dep = relay_pcb[1] + 2*mains_side_clr;

in_x = lv_len;
in_y = mains_y0 + mains_dep;
H    = floor_t + bb[2] + headroom;     // base wall height (lid underside)

out_x = in_x + 2*wall;
out_y = in_y + 2*wall;

boss_r = boss_d / 2;
boss_pos = [[boss_r, boss_r], [in_x - boss_r, boss_r],
            [boss_r, in_y - boss_r], [in_x - boss_r, in_y - boss_r]];

relay_x0 = (in_x - relay_pcb[0]) / 2;
relay_x1 = relay_x0 + relay_pcb[0];
relay_y0 = mains_y0 + mains_side_clr;
relay_hole_pos = [for (sx = [-1, 1], sy = [-1, 1])
    [relay_x0 + relay_pcb[0]/2 + sx*relay_holes[0]/2,
     relay_y0 + relay_pcb[1]/2 + sy*relay_holes[1]/2]];

pass_x0 = relay_x0 + pass_x_off;
gland_x = relay_x1 - gland_from_terminals_end;

devkit_x0 = pocket_x0 + bb_clr + devkit_x_off;           // DevKitC USB edge
devkit_yc = pocket_y0 + pocket[1]/2;
usb_zc    = floor_t + bb[2] + usb_z_above_bb;
led_pos   = [devkit_x0 + led_from_usb, devkit_yc + led_dy];

switch_pos = [lv_len - switch_bay/2, lv_dep/2];

kh_pos = [[kh_inset, mains_y0 + mains_dep/2], [in_x - kh_inset, mains_y0 + mains_dep/2]];
kh_pad = [kh_head_d + 5, kh_slot_len + kh_head_d + 5];
kh_pad_h = kh_lip + kh_channel_h + kh_roof;

tie_pos = [relay_x1 + 9, mains_y0 + mains_dep/2];

ri = max(corner_r - wall, 0.5);  // interior corner radius

// ------------------------------------------------------------ sanity checks

assert(wall >= 2.5, "walls must be >= 2.5 mm");
assert(barrier_t >= 2, "barrier must be >= 2 mm");
assert(headroom >= 20, "keep >= 20 mm above the breadboard");
assert(floor_t + relay_standoff + relay_pcb_t + relay_h < H - 1, "relay module too tall for the case");
assert(switch_body_depth < H - floor_t - 1, "switch body too deep");
assert(switch_body_d/2 < switch_bay/2 + bb_rim_t - 0.5, "switch body overlaps the breadboard pocket");
assert(switch_pos[0] + switch_body_d/2 < in_x - fit_clr - lip_t, "switch body hits the lid lip");
assert(gland_z - gland_d/2 > 1, "gland hole cuts the floor");
assert(gland_z + floor_t + gland_d/2 < H - lip_h - 1, "gland hole clashes with the lid lip");
assert(gland_x + gland_nut_af/2 < in_x - boss_d, "gland locknut clashes with a corner boss");
assert(abs(gland_x - kh_pos[1][0]) > gland_nut_af/2 + kh_pad[0]/2 || gland_z - gland_nut_af/2 > kh_pad_h - floor_t,
       "gland locknut clashes with a keyhole pad");
assert(relay_x1 - (pass_x0 + pass_size[0]) >= 25, "LV pass-through must be well away from the terminals");
assert(pass_z + pass_size[1]/2 + floor_t < H - rib_h - 1, "pass-through cuts into the rib overlap");
assert(kh_pos[0][0] - kh_pad[0]/2 > boss_d && kh_pos[1][0] + kh_pad[0]/2 < in_x - boss_d,
       "keyhole pads clash with corner bosses");
assert(kh_pos[1][0] - kh_pad[0]/2 > tie_pos[0] + 7, "keyhole pad clashes with the tie anchor");
assert(relay_x0 > kh_pos[0][0] + kh_pad[0]/2 && relay_x1 < kh_pos[1][0] - kh_pad[0]/2,
       "relay module overlaps a keyhole pad");
assert(usb_zc - usb_slot[1]/2 > floor_t + bb_rim_h, "USB slot too low");
assert(usb_zc + usb_slot[1]/2 < H - lip_h - 1, "USB slot clashes with the lid lip");
assert(screw_depth > insert_depth + 1, "screw hole shallower than the insert");
assert(screw_depth < H - floor_t - 1, "screw hole breaks through the floor");
// Lid ribs must reach below the barrier top so the creepage path is a labyrinth
assert(rib_h > fit_clr, "lid ribs must overlap the barrier");

echo(str("HEATLINK outer size: ", out_x, " x ", out_y, " x ", H + lid_t, " mm"));
echo(str("HEATLINK interior: ", in_x, " x ", in_y, " x ", H - floor_t, " mm; LV depth ", lv_dep,
         ", mains depth ", mains_dep));

// ---------------------------------------------------------------- helpers

module rrect(size, r) {
    r2 = min(r, min(size[0], size[1]) / 2 - 0.01);
    translate([r2, r2]) offset(r = r2) square([size[0] - 2*r2, size[1] - 2*r2]);
}

module outer_2d()    { translate([-wall, -wall]) rrect([out_x, out_y], corner_r); }
module interior_2d() { rrect([in_x, in_y], ri); }

// Teardrop-topped circle so horizontal holes print without support.
module teardrop_2d(d) {
    r = d / 2;
    // circle plus a 45 degree point, truncated at 1.15 r
    intersection() {
        union() {
            circle(d = d);
            rotate(45) square(r);
        }
        translate([-r, -r]) square([2*r, 2.15*r]);
    }
}

module stadium(w, h) {  // in XY, w along X
    hull() for (s = [-1, 1]) translate([s * (w - h)/2, 0]) circle(d = h);
}

// ------------------------------------------------------------------- base

module boss_solid(p) {
    translate([p[0], p[1], 0]) cylinder(d = boss_d, h = H);
    // web into the corner
    cx = p[0] < in_x/2 ? 0 : p[0];
    cy = p[1] < in_y/2 ? 0 : p[1];
    translate([cx, cy, 0]) cube([boss_r, boss_r, H]);
}

module boss_hole(p) {
    d1 = pilot ? pilot_d : insert_d;
    translate([p[0], p[1], H - screw_depth]) {
        cylinder(d = pilot ? pilot_d : 3.0, h = screw_depth + 1);
        if (!pilot) translate([0, 0, screw_depth - insert_depth]) cylinder(d = insert_d, h = insert_depth + 1);
        // lead-in chamfer
        translate([0, 0, screw_depth - 0.6]) cylinder(d1 = d1, d2 = d1 + 1.2, h = 0.61);
    }
}

module bb_rim() {
    translate([pocket_x0 - bb_rim_t, pocket_y0 - bb_rim_t, 0])
        linear_extrude(floor_t + bb_rim_h) difference() {
            square([pocket[0] + 2*bb_rim_t, pocket[1] + 2*bb_rim_t]);
            translate([bb_rim_t, bb_rim_t]) square(pocket);
            // finger notches midway along the long sides to lift the breadboard out
            for (y = [-1, pocket[1] + bb_rim_t - 1])
                translate([bb_rim_t + pocket[0]/2 - 8, y]) square([16, bb_rim_t + 2]);
        }
}

module barrier() { translate([0, lv_dep, 0]) cube([in_x, barrier_t, H]); }

module relay_standoffs() {
    for (p = relay_hole_pos) translate([p[0], p[1], 0])
        difference() {
            cylinder(d = relay_standoff_d, h = floor_t + relay_standoff);
            translate([0, 0, 1]) cylinder(d = relay_screw_d, h = floor_t + relay_standoff);
        }
}

module keyhole_pad(p) {
    translate([p[0] - kh_pad[0]/2, p[1] - kh_pad[1]/2, 0])
        linear_extrude(kh_pad_h) rrect(kh_pad, 2);
}

// Head enters at +Y (towards the gland), the case drops so the shank rides
// to the -Y end of the slot. Hang the case gland-down.
module keyhole_cut(p) {
    head_c = [p[0], p[1] + kh_slot_len/2];
    slot_e = [p[0], p[1] - kh_slot_len/2];
    // entry hole through lip + channel
    translate([head_c[0], head_c[1], -1]) cylinder(d = kh_head_d, h = kh_lip + kh_channel_h + 1);
    // shank slot through the lip
    translate([0, 0, -1]) linear_extrude(kh_lip + 1.01)
        hull() for (c = [head_c, slot_e]) translate(c) circle(d = kh_slot_w);
    // head channel behind the lip
    translate([0, 0, kh_lip]) linear_extrude(kh_channel_h)
        hull() for (c = [head_c, slot_e]) translate(c) circle(d = kh_head_d + 0.4);
}

module tie_anchor(p) {
    // a bridge on the floor: pass a cable tie under it to dress the boiler cable
    translate([p[0], p[1], floor_t]) difference() {
        translate([-6.5, -3, 0]) cube([13, 6, 5]);
        translate([-3, -4, -1]) cube([6, 8, 3.5]);
    }
}

module base() {
    difference() {
        union() {
            difference() {
                linear_extrude(H) outer_2d();
                translate([0, 0, floor_t]) linear_extrude(H) interior_2d();
            }
            intersection() {
                linear_extrude(H) interior_2d();
                union() {
                    for (p = boss_pos) boss_solid(p);
                    barrier();
                }
            }
            bb_rim();
            relay_standoffs();
            for (p = kh_pos) keyhole_pad(p);
            tie_anchor(tie_pos);
        }
        for (p = boss_pos) boss_hole(p);
        for (p = kh_pos) keyhole_cut(p);
        // USB cable slot, left (USB-end) wall
        translate([-wall/2, devkit_yc, usb_zc]) rotate([0, 90, 0]) rotate([0, 0, 90])
            linear_extrude(wall + 2, center = true) stadium(usb_slot[0], usb_slot[1]);
        // PG7 gland, back (mains) wall, in line with the terminals
        translate([gland_x, in_y + wall/2, floor_t + gland_z]) rotate([90, 0, 0])
            linear_extrude(wall + 2, center = true) teardrop_2d(gland_d);
        // low-voltage pass-through in the barrier, at the module's header end
        barrier_pass_cut();
    }
}

module barrier_pass_cut() {
    translate([pass_x0 + pass_size[0]/2, lv_dep + barrier_t/2, floor_t + pass_z])
        rotate([90, 0, 0]) linear_extrude(barrier_t + 2, center = true)
            offset(r = 1) offset(delta = -1) square(pass_size, center = true);
}

// -------------------------------------------------------------------- lid
// Built as assembled: plate from z=0 (underside) to z=lid_t, lip/ribs below 0.

module lid_lip() {
    translate([0, 0, -lip_h]) linear_extrude(lip_h + 0.01) difference() {
        offset(delta = -fit_clr) interior_2d();
        offset(delta = -fit_clr - lip_t) interior_2d();
        // clear the corner bosses
        for (p = boss_pos) {
            translate(p) circle(r = boss_r + fit_clr);
            cx = p[0] < in_x/2 ? -1 : p[0];
            cy = p[1] < in_y/2 ? -1 : p[1];
            translate([cx, cy]) square([boss_r + 1 + fit_clr, boss_r + 1 + fit_clr]);
        }
        // clear the barrier ends
        translate([-1, lv_dep - fit_clr]) square([in_x + 2, barrier_t + 2*fit_clr]);
    }
}

module lid_ribs() {
    // two ribs straddling the barrier top: tongue-in-groove creepage labyrinth
    for (y = [lv_dep - fit_clr - rib_t, lv_dep + barrier_t + fit_clr])
        translate([fit_clr, y, -rib_h]) cube([in_x - 2*fit_clr, rib_t, rib_h + 0.01]);
}

module screw_clear(p) {
    translate([p[0], p[1], -1]) cylinder(d = screw_clear_d, h = lid_t + 2);
    if (screw_head == "csk")
        translate([p[0], p[1], lid_t - (csk_d - screw_clear_d)/2])
            cylinder(d1 = screw_clear_d, d2 = csk_d, h = (csk_d - screw_clear_d)/2 + 0.01);
    else
        translate([p[0], p[1], lid_t - cbore[1]]) cylinder(d = cbore[0], h = cbore[1] + 0.01);
}

module deboss_text(t, size, pos, rot = 0, halign = "center") {
    translate([pos[0], pos[1], lid_t - deboss]) rotate(rot)
        linear_extrude(deboss + 0.01)
            text(t, size = size, font = font, halign = halign, valign = "center");
}

module switch_labels() {
    r = switch_hole_d/2 + 4 + label_size/2;
    if (switch_type == "rotary") {
        // positions: ON left, AUTO up, OFF right (as seen from the front)
        for (l = [["ON", 135], ["AUTO", 90], ["OFF", 45]])
            deboss_text(l[0], label_size, switch_pos + (r + 3) * [cos(l[1]), sin(l[1])]);
    } else {
        // mini toggle ON-OFF-ON: up = ON, centre = AUTO, down = OFF
        deboss_text("ON",   label_size, switch_pos + [0,  r]);
        deboss_text("AUTO", label_size, switch_pos + [-(r - 2), 0], halign = "right");
        deboss_text("OFF",  label_size, switch_pos + [0, -r]);
    }
}

module warning_label() {
    c = [in_x/2, mains_y0 + mains_dep/2];
    // warning triangle outline + "!" + 230V
    tri = 9;
    translate([c[0] - 16, c[1], lid_t - deboss]) linear_extrude(deboss + 0.01) {
        difference() {
            offset(r = 0.5) polygon([[-tri/2, -tri*0.4], [tri/2, -tri*0.4], [0, tri*0.47]]);
            offset(delta = -1.2) polygon([[-tri/2, -tri*0.4], [tri/2, -tri*0.4], [0, tri*0.47]]);
        }
        translate([0, -0.6]) text("!", size = 4, font = font, halign = "center", valign = "center");
    }
    deboss_text(warn_text, 7, [c[0] - 9, c[1]], halign = "left");
}

module lid_local() {
    difference() {
        union() {
            linear_extrude(lid_t) outer_2d();
            lid_lip();
            lid_ribs();
        }
        for (p = boss_pos) screw_clear(p);
        // switch
        translate([switch_pos[0], switch_pos[1], -1]) cylinder(d = switch_hole_d, h = lid_t + 2);
        if (anti_rot)
            translate([switch_pos[0] + anti_rot_r * cos(anti_rot_angle),
                       switch_pos[1] + anti_rot_r * sin(anti_rot_angle), -1])
                cylinder(d = anti_rot_d, h = 1 + lid_t - 1.0);  // blind: leaves 1 mm skin on top
        // LED window / light pipe
        translate([led_pos[0], led_pos[1], -1]) cylinder(d = led_hole_d, h = lid_t + 2);
        if (led_cbore[0] > 0)
            translate([led_pos[0], led_pos[1], lid_t - led_cbore[1]]) cylinder(d = led_cbore[0], h = led_cbore[1] + 0.01);
        // labels
        switch_labels();
        warning_label();
        deboss_text(title_text, title_size, [pocket_x0 + pocket[0]/2 + 6, 11]);
        deboss_text("LED", 3, led_pos + [0, 6]);
    }
}

// ------------------------------------------------------- ghost components

module ghosts() {
    color("white", 0.8) translate([pocket_x0 + bb_clr, pocket_y0 + bb_clr, floor_t]) cube(bb);
    color("darkgreen") translate([devkit_x0, devkit_yc - devkit[1]/2, floor_t + bb[2] + 2.5]) cube([devkit[0], devkit[1], 1.6]);
    color("silver") for (s = [-1, 1])
        translate([devkit_x0 - 1, devkit_yc + s*6.5 - 4.5, usb_zc - 1.6]) cube([7.5, 9, 3.2]);
    color("red") translate([led_pos[0], led_pos[1], floor_t + bb[2] + 4.1]) cylinder(d = 2, h = 1);
    color("blue", 0.9) translate([relay_x0, relay_y0, floor_t + relay_standoff]) cube([relay_pcb[0], relay_pcb[1], relay_pcb_t]);
    color("dodgerblue") translate([relay_x0 + 8, relay_y0 + 3, floor_t + relay_standoff + relay_pcb_t]) cube([19, 15.5, relay_h - 3]);
    color("royalblue") translate([relay_x1 - 8, relay_y0 + 3, floor_t + relay_standoff + relay_pcb_t]) cube([7.5, 15, 10]);
    color("black") translate([switch_pos[0], switch_pos[1], H - switch_body_depth]) cylinder(d = switch_body_d, h = switch_body_depth);
}

// ---------------------------------------------------------------- output

module lid_print() { translate([0, 0, lid_t]) rotate([180, 0, 0]) lid_local(); }

if (part == "base") {
    base();
} else if (part == "lid") {
    lid_print();
} else if (part == "section") {
    // closed case cut through the LV pass-through and the gland, for checking fits
    intersection() {
        union() {
            color("lightgrey") base();
            color("orange") translate([0, 0, H]) lid_local();
        }
        translate([-50, -50, -50]) cube([pass_x0 + pass_size[0]/2 + 50, in_y + 100, H + 100]);
    }
} else if (part == "rib_overlap") {
    // Must render NON-EMPTY: the lid's groove ribs reach down past the barrier top.
    intersection() {
        hull() translate([0, 0, H + 0.01]) lid_ribs();
        barrier();
    }
} else if (part == "check") {
    // Must render EMPTY: any solid here is a base/lid interference.
    // (lid lifted 0.01 mm: the faces that rest on each other are meant to touch)
    intersection() { base(); translate([0, 0, H + 0.01]) lid_local(); }
} else {
    color("lightgrey") base();
    color("orange", 0.45) translate([0, 0, H + explode]) lid_local();
    ghosts();
}
