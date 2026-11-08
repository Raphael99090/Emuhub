; endereço (16 bits), banco e 1 se a pose é larga (128 px)
PoseTbl:
  .dw Pose0
  .db :Pose0, 0 ; idle0
  .dw Pose1
  .db :Pose1, 0 ; idle1
  .dw Pose2
  .db :Pose2, 1 ; walk0
  .dw Pose3
  .db :Pose3, 1 ; walk1
  .dw Pose4
  .db :Pose4, 1 ; walk2
  .dw Pose5
  .db :Pose5, 1 ; walk3
  .dw Pose6
  .db :Pose6, 1 ; jump
  .dw Pose7
  .db :Pose7, 1 ; crouch
  .dw Pose8
  .db :Pose8, 1 ; punch
  .dw Pose9
  .db :Pose9, 1 ; kick
  .dw Pose10
  .db :Pose10, 0 ; hurt
  .dw Pose11
  .db :Pose11, 1 ; ko
  .dw Pose12
  .db :Pose12, 0 ; victory
  .dw Pose13
  .db :Pose13, 0 ; block
.define NFRAMES 14
