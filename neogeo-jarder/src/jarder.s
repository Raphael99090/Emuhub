; Jarder - Neo Geo (estagio 1: Jarder parado na Avenida animada, com rolagem)
; Montar com vasmm68k_mot -Fbin -m68000 (ver build.sh)

BIOS_SYSTEM_MODE  equ $10fd80
BIOS_P1CURRENT    equ $10fd96
BIOS_USER_REQUEST equ $10fdae
SYSTEM_INT1       equ $c00438
SYSTEM_RETURN     equ $c00444
SYSTEM_IO         equ $c0044a

REG_VRAMADDR equ $3c0000
REG_VRAMRW   equ $3c0002
REG_VRAMMOD  equ $3c0004
REG_LSPCMODE equ $3c0006
REG_IRQACK   equ $3c000c
REG_WATCHDOG equ $300001
REG_CRTFIX   equ $3a001b
REG_PALBANK0 equ $3a001f
PALRAM       equ $400000

; variaveis (RAM de trabalho)
V_CAM    equ $100000      ; w  camara 0..192
V_JX     equ $100002      ; w  x do Jarder na tela
V_FRAME  equ $100004      ; w  quadro de idle (0..11)
V_TICK   equ $100006      ; w  contador
V_READY  equ $100008      ; w  jogo iniciado
V_DIR    equ $10000a      ; w  0 direita, 1 esquerda
V_MOV    equ $10000c      ; w  1 andando
V_LASTDIR equ $10000e     ; w  lado desenhado

SPR_STAGE  equ 0          ; sprites 0..43
SPR_JARDER equ 44         ; sprites 44..49
CAM_MAX    equ 367
GROUND_Y   equ 50         ; topo do sprite do Jarder (pes em ~210)

        org $000000
; --- vetores ---
        dc.l $10f300, $c00402, $c00408, $c0040e, $c00414, $c0041a, $c0041a, $c0041a
        dc.l $c0041a, $c00420, $c00426, $c00426
        dcb.l 3,$ffffffff
        dc.l $c0042c
        dcb.l 8,$ffffffff
        dc.l $c00432
        dc.l vblank, timer
        dc.l 0
        dcb.l 4,0
        dcb.l 16,$ffffffff
        dcb.l 8,$ffffffff
        dcb.l 3,$ffffffff
        dcb.l 5,$ffffffff
; --- cabecalho $100 ---
        dc.b "NEO-GEO",0
        dc.w $0999
        dc.l $00100000
        dc.l $00000000
        dc.w $0000
        dc.b 0,0
        dc.l dip, dip, dip
        jmp user.l
        jmp rts_stub.l
        jmp rts_stub.l
        jmp rts_stub.l
        dcb.b 70,$ff
        dc.w 0
        dc.l scode
scode:  dc.w $7600,$4a6d,$0a14,$6600,$003c,$206d,$0a04,$3e2d
        dc.w $0a08,$13c0,$0030,$0001,$3210,$0c01,$00ff,$671a
        dc.w $3028,$0002,$b02d,$0ace,$6610,$3028,$0004,$b02d
        dc.w $0acf,$6606,$b22d,$0ad0,$6708,$5088,$51cf,$ffd4
        dc.w $3607,$4e75,$206d,$0a04,$3e2d,$0a08,$3210,$e049
        dc.w $0c01,$00ff,$671a,$3010,$b02d,$0ace,$6612,$3028
        dc.w $0002,$e048,$b02d,$0acf,$6606,$b22d,$0ad0,$6708
        dc.w $5888,$51cf,$ffd8,$3607,$4e75

dip:    dc.b "JARDER",0
        dcb.b 57,0

rts_stub:
        rts

timer:  move.w #2,REG_IRQACK
        rte

; --- vblank ---
vblank:
        btst #7,BIOS_SYSTEM_MODE
        bne.s .game
        jmp SYSTEM_INT1.l
.game:
        move.w #4,REG_IRQACK
        move.b d0,REG_WATCHDOG
        movem.l d0-d7/a0-a6,-(sp)
        tst.w V_READY
        beq.s .done
        jsr SYSTEM_IO.l
        bsr update
.done:  movem.l (sp)+,d0-d7/a0-a6
        rte

; --- USER ---
user:
        move.b BIOS_USER_REQUEST,d0
        bne.s .start
        jmp SYSTEM_RETURN.l
.start:
        move.w #$2700,sr
        lea $10f300,sp
        move.b d0,REG_WATCHDOG
        bsr init
        move.w #1,V_READY
        move.w #$2000,sr
.loop:  move.b d0,REG_WATCHDOG
        bra.s .loop

; --- util: escreve palavra d1 no endereco VRAM d0 ---
init:
        move.b d0,REG_CRTFIX
        move.b d0,REG_PALBANK0
        ; paletas
        lea pal_data,a0
        lea PALRAM,a1
        move.w #4095,d0
.pl:    move.w (a0)+,(a1)+
        dbra d0,.pl
        move.w #$0000,$401ffe          ; fundo preto
        move.w #$0000,PALRAM           ; palette 0 / cor 0
        ; limpar VRAM: SCB1+fix ($0000-$7FFF) e SCB2-4 ($8000-$87FF)
        move.w #1,REG_VRAMMOD
        move.w #0,REG_VRAMADDR
        move.w #$7fff,d0
.c1:    move.w #0,REG_VRAMRW
        dbra d0,.c1
        move.w #$8000,REG_VRAMADDR
        move.w #$7ff,d0
.c2:    move.w #0,REG_VRAMRW
        dbra d0,.c2
        ; --- palco: SCB1 dos sprites 0..43 (14 tiles cada) ---
        lea stage_scb1,a0
        moveq #0,d2
.sp:    move.w d2,d3
        lsl.w #6,d3
        move.w d3,REG_VRAMADDR
        moveq #27,d0
.sr:    move.w (a0)+,REG_VRAMRW
        dbra d0,.sr
        addq.w #1,d2
        cmp.w #44,d2
        bne.s .sp
        ; SCB2: tamanho total
        move.w #$8000+SPR_STAGE,REG_VRAMADDR
        moveq #43,d0
.s2:    move.w #$0fff,REG_VRAMRW
        dbra d0,.s2
        ; --- Jarder: sprites 32..34 ---
        move.w #$8000+SPR_JARDER,REG_VRAMADDR
        moveq #5,d0
.sj:    move.w #$0fff,REG_VRAMRW
        dbra d0,.sj
        move.w #$8200+SPR_JARDER,REG_VRAMADDR
        move.w #((496-GROUND_Y)<<7)|10,REG_VRAMRW
        move.w #$0040,REG_VRAMRW
        move.w #$0040,REG_VRAMRW
        move.w #$0040,REG_VRAMRW
        move.w #$0040,REG_VRAMRW
        move.w #$0040,REG_VRAMRW
        move.w #96,V_CAM
        move.w #110,V_JX
        clr.w V_FRAME
        clr.w V_TICK
        clr.w V_DIR
        clr.w V_MOV
        bsr draw_jarder
        bsr set_pos
        ; auto-animacao do LSPC: ~a cada 20 quadros
        move.w #$0c00,REG_LSPCMODE
        rts

; escreve os 6x10 tiles do quadro atual (idle 0-7, andar 8-15), espelhado se V_DIR=1
draw_jarder:
        lea jarder_scb1,a0
        moveq #0,d0
        move.w V_FRAME,d0
        tst.w V_MOV
        beq.s .m0
        add.w #8,d0
.m0:    mulu #240,d0                   ; 60 tiles * 4 bytes
        add.l d0,a0
        moveq #0,d4
        tst.w V_DIR
        beq.s .dr
        moveq #1,d4                    ; bit de espelho horizontal
.dr:    move.w V_DIR,V_LASTDIR
        moveq #0,d2
.col:   move.w d2,d3
        tst.w V_DIR
        beq.s .nf
        moveq #5,d3
        sub.w d2,d3
.nf:    add.w #SPR_JARDER,d3
        lsl.w #6,d3
        move.w d3,REG_VRAMADDR
        moveq #9,d0
.w:     move.w (a0)+,REG_VRAMRW
        move.w (a0)+,d5
        or.w d4,d5
        move.w d5,REG_VRAMRW
        dbra d0,.w
        addq.w #1,d2
        cmp.w #6,d2
        bne.s .col
        rts

set_pos:
        ; palco: 44 sprites independentes; os fora da tela ficam com altura 0
        lea 0,a0
        move.w V_CAM,d1
        moveq #0,d2
.ps:    move.w d2,d0
        lsl.w #4,d0
        sub.w d1,d0                    ; x = 16*i - cam
        move.w d2,d3
        add.w #$8200+SPR_STAGE,d3
        move.w d3,REG_VRAMADDR
        cmp.w #-16,d0
        ble.s .hid
        cmp.w #320,d0
        bge.s .hid
        move.w #((496)<<7)|14,REG_VRAMRW
        bra.s .px
.hid:   move.w #0,REG_VRAMRW
.px:    and.w #$1ff,d0
        lsl.w #7,d0
        add.w #$200,d3                 ; $8400 + i
        move.w d3,REG_VRAMADDR
        move.w d0,REG_VRAMRW
        addq.w #1,d2
        cmp.w #44,d2
        bne.s .ps
        move.w #$8400+SPR_JARDER,REG_VRAMADDR
        move.w V_JX,d0
        and.w #$1ff,d0
        lsl.w #7,d0
        move.w d0,REG_VRAMRW
        rts

update:
        move.b BIOS_P1CURRENT,d1
        moveq #0,d4                    ; d4 = andando?
        move.w V_JX,d0
        btst #3,d1
        beq.s .nr
        addq.w #2,d0
        clr.w V_DIR
        moveq #1,d4
.nr:    btst #2,d1
        beq.s .nl
        subq.w #2,d0
        move.w #1,V_DIR
        moveq #1,d4
.nl:    move.w V_CAM,d2
        cmp.w #190,d0
        ble.s .c1
        move.w d0,d3
        sub.w #190,d3
        move.w #190,d0
        add.w d3,d2
.c1:    cmp.w #80,d0
        bge.s .c2
        move.w d0,d3
        sub.w #80,d3
        move.w #80,d0
        add.w d3,d2
.c2:    tst.w d2
        bge.s .c3
        move.w d2,d3
        moveq #0,d2
        add.w d3,d0
.c3:    cmp.w #CAM_MAX,d2
        ble.s .c4
        move.w d2,d3
        sub.w #CAM_MAX,d3
        move.w #CAM_MAX,d2
        add.w d3,d0
.c4:    cmp.w #0,d0
        bge.s .c5
        moveq #0,d0
.c5:    cmp.w #240,d0
        ble.s .c6
        move.w #240,d0
.c6:    move.w d0,V_JX
        move.w d2,V_CAM
        ; mudou de estado ou de lado: reinicia a animacao
        moveq #0,d6
        cmp.w V_MOV,d4
        beq.s .sm
        move.w d4,V_MOV
        clr.w V_FRAME
        clr.w V_TICK
        moveq #1,d6
.sm:    move.w V_DIR,d0
        cmp.w V_LASTDIR,d0
        beq.s .sd
        moveq #1,d6
.sd:    ; troca de quadro: andar a cada 4 vblanks, idle a cada 8
        move.w V_TICK,d0
        addq.w #1,d0
        moveq #8,d5
        tst.w V_MOV
        beq.s .tp
        moveq #4,d5
.tp:    cmp.w d5,d0
        blt.s .nt
        moveq #0,d0
        move.w V_FRAME,d1
        addq.w #1,d1
        and.w #7,d1
        move.w d1,V_FRAME
        moveq #1,d6
.nt:    move.w d0,V_TICK
        tst.w d6
        beq.s .nd
        bsr draw_jarder
.nd:    bra set_pos

        even
pal_data:    incbin "../build/pal.bin"
stage_scb1:  incbin "../build/scb1_stage.bin"
jarder_scb1: incbin "../build/scb1_jarder.bin"
